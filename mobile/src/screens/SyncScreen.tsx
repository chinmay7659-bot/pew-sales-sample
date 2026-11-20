import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { APPS_SCRIPT_TEMPLATE } from '../services/appsScriptTemplate';
import { SyncSettings } from '../storage/syncSettings';
import { COLORS, RADII } from '../theme';
import { extractSpreadsheetId } from '../utils/stockUtils';

WebBrowser.maybeCompleteAuthSession();

const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() || '';
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || '';
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || '';

const OAUTH_AVAILABLE =
  (Platform.OS === 'android' && ANDROID_CLIENT_ID.length > 0) ||
  (Platform.OS === 'ios' && IOS_CLIENT_ID.length > 0) ||
  (Platform.OS === 'web' && WEB_CLIENT_ID.length > 0);

interface GoogleOAuthControlsProps {
  hasToken: boolean;
  spreadsheetId: string;
  syncing: boolean;
  onTokenReceived: (token: string) => void;
  onConnectSpreadsheet: (spreadsheetId: string) => void;
  onCreateSpreadsheet: () => void;
  onSignOutOAuth: () => void;
}

function GoogleOAuthControls({
  hasToken,
  spreadsheetId,
  syncing,
  onTokenReceived,
  onConnectSpreadsheet,
  onCreateSpreadsheet,
  onSignOutOAuth,
}: GoogleOAuthControlsProps) {
  const [sheetInput, setSheetInput] = useState(spreadsheetId);
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: ANDROID_CLIENT_ID || undefined,
    iosClientId: IOS_CLIENT_ID || undefined,
    webClientId: WEB_CLIENT_ID || undefined,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'profile', 'email'],
  });

  useEffect(() => {
    if (response?.type === 'success' && response.authentication?.accessToken) {
      onTokenReceived(response.authentication.accessToken);
    }
  }, [response, onTokenReceived]);

  if (!hasToken) {
    return (
      <Pressable
        disabled={!request}
        onPress={() => promptAsync()}
        style={[styles.primaryBtn, !request && styles.disabledBtn]}
      >
        <Ionicons name="logo-google" size={18} color={COLORS.primaryText} />
        <Text style={styles.primaryBtnText}>Sign in with Google</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.oauthBody}>
      <TextInput
        value={sheetInput}
        onChangeText={setSheetInput}
        placeholder="Paste Google Sheet URL or ID…"
        placeholderTextColor={COLORS.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.rowBtns}>
        <Pressable
          disabled={!sheetInput.trim() || syncing}
          onPress={() => {
            const id = extractSpreadsheetId(sheetInput);
            if (id) onConnectSpreadsheet(id);
          }}
          style={[styles.primaryBtn, styles.flexBtn, (!sheetInput.trim() || syncing) && styles.disabledBtn]}
        >
          <Text style={styles.primaryBtnText}>Connect Sheet</Text>
        </Pressable>
        <Pressable
          disabled={syncing}
          onPress={onCreateSpreadsheet}
          style={[styles.secondaryBtn, styles.flexBtn, syncing && styles.disabledBtn]}
        >
          <Text style={styles.secondaryBtnText}>Create Sheet</Text>
        </Pressable>
      </View>
      <Pressable onPress={onSignOutOAuth} style={styles.linkBtn}>
        <Text style={styles.dangerLinkText}>Sign out of Google</Text>
      </Pressable>
    </View>
  );
}

interface SyncScreenProps {
  settings: SyncSettings;
  hasOAuthToken: boolean;
  sheetTitle: string | null;
  syncing: boolean;
  lastSyncedAt: number | null;
  syncError: string | null;
  onUpdateMemberName: (name: string) => void;
  onConnectBridge: (bridgeUrl: string, seedIfEmpty: boolean) => Promise<void>;
  onDisconnect: () => void;
  onSyncNow: () => Promise<void>;
  onOAuthToken: (token: string) => void;
  onConnectOAuthSheet: (spreadsheetId: string) => Promise<void>;
  onCreateOAuthSheet: () => Promise<void>;
  onSignOutOAuth: () => void;
}

export default function SyncScreen({
  settings,
  hasOAuthToken,
  sheetTitle,
  syncing,
  lastSyncedAt,
  syncError,
  onUpdateMemberName,
  onConnectBridge,
  onDisconnect,
  onSyncNow,
  onOAuthToken,
  onConnectOAuthSheet,
  onCreateOAuthSheet,
  onSignOutOAuth,
}: SyncScreenProps) {
  const [bridgeInput, setBridgeInput] = useState(settings.bridgeUrl);
  const [nameInput, setNameInput] = useState(settings.memberName);
  const [showScriptGuide, setShowScriptGuide] = useState(false);

  useEffect(() => {
    setBridgeInput(settings.bridgeUrl);
  }, [settings.bridgeUrl]);

  useEffect(() => {
    setNameInput(settings.memberName);
  }, [settings.memberName]);

  const isConnected =
    (settings.mode === 'bridge' && settings.bridgeUrl.trim().length > 0) ||
    (settings.mode === 'oauth' && hasOAuthToken && settings.spreadsheetId.trim().length > 0);

  const formattedSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const handleShareScript = async () => {
    try {
      await Share.share({
        title: 'Google Apps Script for Sample Stock Log',
        message: APPS_SCRIPT_TEMPLATE,
      });
    } catch {
      // Ignore share cancellation
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Status Banner */}
        <View style={styles.card}>
          <View style={styles.statusHeader}>
            <View style={styles.statusIcon}>
              <Ionicons
                name={isConnected ? 'cloud-done-outline' : 'phone-portrait-outline'}
                size={20}
                color={isConnected ? COLORS.convertedText : COLORS.textMuted}
              />
            </View>
            <View style={styles.statusTextWrap}>
              <Text style={styles.cardTitle}>
                {isConnected
                  ? sheetTitle || 'Connected to Google Sheet'
                  : 'Local Device Mode'}
              </Text>
              <Text style={styles.cardSub}>
                {isConnected
                  ? `Auto-sync active${formattedSync ? ` · Last synced ${formattedSync}` : ''}`
                  : 'Connect a Google Sheet below so all 20 team members share live records outside AI Studio.'}
              </Text>
            </View>
          </View>

          {syncError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{syncError}</Text>
            </View>
          )}

          {isConnected && (
            <View style={styles.rowBtns}>
              <Pressable
                onPress={onSyncNow}
                disabled={syncing}
                style={[styles.primaryBtn, styles.flexBtn, syncing && styles.disabledBtn]}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color={COLORS.primaryText} />
                ) : (
                  <Ionicons name="refresh" size={16} color={COLORS.primaryText} />
                )}
                <Text style={styles.primaryBtnText}>{syncing ? 'Syncing…' : 'Sync Now'}</Text>
              </Pressable>

              <Pressable onPress={onDisconnect} style={[styles.secondaryBtn, styles.flexBtn]}>
                <Text style={styles.dangerBtnText}>Disconnect</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Teammate Display Name */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your Name (for record history)</Text>
          <Text style={styles.cardSub}>
            Shown as "by Name" on records you add or edit on this phone.
          </Text>
          <View style={styles.inlineRow}>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="e.g., Rahul or Priya"
              placeholderTextColor={COLORS.textMuted}
              style={[styles.input, styles.inlineInput]}
            />
            <Pressable
              onPress={() => onUpdateMemberName(nameInput.trim())}
              style={styles.smallSaveBtn}
            >
              <Text style={styles.smallSaveBtnText}>Save</Text>
            </Pressable>
          </View>
        </View>

        {/* Method 1: Google Sheet Sync URL (Apps Script Bridge - Works immediately in any APK) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Google Sheet Sync URL (Recommended)</Text>
          <Text style={styles.cardSub}>
            Works in any installed Android APK or phone with zero Google Cloud OAuth setup. Paste your Sheet Web App URL once and share the same URL with all 20 team members.
          </Text>

          <TextInput
            value={bridgeInput}
            onChangeText={setBridgeInput}
            placeholder="https://script.google.com/macros/s/.../exec"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <View style={styles.rowBtns}>
            <Pressable
              disabled={!bridgeInput.trim() || syncing}
              onPress={() => onConnectBridge(bridgeInput.trim(), true)}
              style={[
                styles.primaryBtn,
                styles.flexBtn,
                (!bridgeInput.trim() || syncing) && styles.disabledBtn,
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {syncing ? 'Connecting…' : 'Connect & Sync'}
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setShowScriptGuide((v) => !v)}
            style={styles.guideToggle}
          >
            <Text style={styles.guideToggleText}>
              {showScriptGuide ? 'Hide 2-minute Google Sheet setup' : 'How to get your free Sheet Sync URL'}
            </Text>
            <Ionicons
              name={showScriptGuide ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={COLORS.primary}
            />
          </Pressable>

          {showScriptGuide && (
            <View style={styles.guideBox}>
              <Text style={styles.guideStep}>
                1. Open your Google Sheet in a browser (create a new blank sheet at sheets.new).
              </Text>
              <Text style={styles.guideStep}>
                2. Click Extensions → Apps Script, replace the code with the template below, and save.
              </Text>
              <Text style={styles.guideStep}>
                3. Click Deploy → New deployment → Web app. Set "Execute as" to Me and "Who has access" to Anyone, then click Deploy.
              </Text>
              <Text style={styles.guideStep}>
                4. Copy the Web app URL (ends in /exec), paste it above, and tap Connect &amp; Sync.
              </Text>
              <Pressable onPress={handleShareScript} style={styles.secondaryBtn}>
                <Ionicons name="share-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryBtnText}>Copy / Share Apps Script Code</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Method 2: Direct Google OAuth (when native OAuth client ID is configured) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Direct Google Sign-In (Optional)</Text>
          {OAUTH_AVAILABLE ? (
            <GoogleOAuthControls
              hasToken={hasOAuthToken}
              spreadsheetId={settings.spreadsheetId}
              syncing={syncing}
              onTokenReceived={onOAuthToken}
              onConnectSpreadsheet={onConnectOAuthSheet}
              onCreateSpreadsheet={onCreateOAuthSheet}
              onSignOutOAuth={onSignOutOAuth}
            />
          ) : (
            <Text style={styles.cardSub}>
              Uses the Sheet Sync URL above by default. To enable direct Google Sign-In inside a standalone APK, set EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in mobile/.env before building.
            </Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: 14,
    gap: 10,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextWrap: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  cardSub: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textMuted,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  inlineInput: {
    flex: 1,
  },
  smallSaveBtn: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
  },
  smallSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
  rowBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  flexBtn: {
    flex: 1,
  },
  primaryBtn: {
    minHeight: 46,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  dangerBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.danger,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  oauthBody: {
    gap: 10,
  },
  linkBtn: {
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dangerLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.danger,
  },
  errorBox: {
    backgroundColor: COLORS.dangerSoft,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: RADII.sm,
    padding: 10,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.danger,
  },
  guideToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  guideToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  guideBox: {
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: RADII.sm,
    padding: 12,
    gap: 8,
  },
  guideStep: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.text,
  },
});
