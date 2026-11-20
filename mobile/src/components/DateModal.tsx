import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS, RADII } from '../theme';
import { formatDateDisplay, localToday, shiftYmd } from '../utils/stockUtils';

interface DateModalProps {
  visible: boolean;
  value: string;
  onSelect: (ymd: string) => void;
  onClose: () => void;
}

export default function DateModal({ visible, value, onSelect, onClose }: DateModalProps) {
  const [draft, setDraft] = useState(value || localToday());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft(value || localToday());
      setError(null);
    }
  }, [value, visible]);

  const applyDate = (next: string) => {
    setDraft(next);
    setError(null);
  };

  const handleConfirm = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
      setError('Use YYYY-MM-DD format (e.g. 2026-11-19).');
      return;
    }
    const parsed = new Date(`${draft}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      setError('Enter a valid calendar date.');
      return;
    }
    onSelect(draft);
    onClose();
  };

  const today = localToday();
  const yesterday = shiftYmd(today, -1);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Select Date</Text>
          <Text style={styles.preview}>{formatDateDisplay(draft) || 'Invalid date'}</Text>

          <View style={styles.quickRow}>
            <Pressable
              onPress={() => applyDate(today)}
              style={[styles.quickBtn, draft === today && styles.quickBtnActive]}
            >
              <Text style={[styles.quickText, draft === today && styles.quickTextActive]}>
                Today
              </Text>
            </Pressable>
            <Pressable
              onPress={() => applyDate(yesterday)}
              style={[styles.quickBtn, draft === yesterday && styles.quickBtnActive]}
            >
              <Text style={[styles.quickText, draft === yesterday && styles.quickTextActive]}>
                Yesterday
              </Text>
            </Pressable>
          </View>

          <View style={styles.stepRow}>
            <Pressable
              onPress={() => applyDate(shiftYmd(draft, -1))}
              style={styles.stepBtn}
            >
              <Text style={styles.stepText}>− 1 day</Text>
            </Pressable>
            <Pressable
              onPress={() => applyDate(shiftYmd(draft, 1))}
              style={styles.stepBtn}
            >
              <Text style={styles.stepText}>+ 1 day</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
          <TextInput
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setError(null);
            }}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            style={styles.input}
          />
          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={handleConfirm} style={styles.confirmBtn}>
              <Text style={styles.confirmText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADII.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  preview: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  quickBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceSoft,
  },
  quickBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primarySoft,
  },
  quickText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  quickTextActive: {
    color: COLORS.primary,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  stepBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    fontSize: 15,
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  error: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.danger,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  confirmBtn: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
});
