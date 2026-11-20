import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import DateModal from '../components/DateModal';
import PickerSheet from '../components/PickerSheet';
import { COLORS, RADII } from '../theme';
import { AppData, SampleRecord, SampleStatus } from '../types/stock';
import {
  ci,
  computeHeldQty,
  formatDateDisplay,
  localToday,
  mk,
  nk,
  uid,
} from '../utils/stockUtils';

interface NewRecordScreenProps {
  data: AppData;
  onAddRecord: (record: SampleRecord) => Promise<boolean> | boolean | void;
  onGoToManage: () => void;
}

const STATUS_OPTIONS: SampleStatus[] = ['Sent', 'Returned', 'Converted to sale'];

export default function NewRecordScreen({
  data,
  onAddRecord,
  onGoToManage,
}: NewRecordScreenProps) {
  const [salesperson, setSalesperson] = useState('');
  const [date, setDate] = useState(localToday);
  const [design, setDesign] = useState('');
  const [model, setModel] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const [traysInput, setTraysInput] = useState('');
  const [status, setStatus] = useState<SampleStatus>('Sent');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  const [pickerKind, setPickerKind] = useState<'salesperson' | 'design' | 'model' | null>(null);
  const [dateModalOpen, setDateModalOpen] = useState(false);

  const salespeopleOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data.samples) {
      const k = nk(s.salesperson);
      if (k && !map.has(k)) map.set(k, s.salesperson.trim());
    }
    for (const sp of data.salespeople) {
      const k = nk(sp.name);
      if (k) map.set(k, sp.name);
    }
    return Array.from(map.values())
      .sort(ci)
      .map((name) => ({ label: name, value: name }));
  }, [data.salespeople, data.samples]);

  const designOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data.samples) {
      const k = nk(s.design);
      if (k && !map.has(k)) map.set(k, s.design.trim());
    }
    for (const m of data.models) {
      const k = nk(m.design);
      if (k && !map.has(k)) map.set(k, m.design.trim());
    }
    for (const d of data.designs) {
      const k = nk(d.name);
      if (k) map.set(k, d.name);
    }
    return Array.from(map.values())
      .sort(ci)
      .map((name) => ({ label: name, value: name }));
  }, [data.designs, data.models, data.samples]);

  const modelOptions = useMemo(() => {
    const dk = nk(design);
    if (!dk) return [];
    const map = new Map<string, string>();
    for (const s of data.samples) {
      if (nk(s.design) === dk && nk(s.item)) {
        const key = mk(s.design, s.item);
        if (!map.has(key)) map.set(key, s.item.trim());
      }
    }
    for (const m of data.models) {
      if (nk(m.design) === dk && nk(m.name)) {
        map.set(mk(m.design, m.name), m.name);
      }
    }
    return Array.from(map.values())
      .sort(ci)
      .map((name) => ({ label: name, value: name }));
  }, [design, data.models, data.samples]);

  const effectiveSalesperson = salespeopleOptions.some((o) => o.value === salesperson)
    ? salesperson
    : '';
  const effectiveDesign = designOptions.some((o) => o.value === design) ? design : '';
  const effectiveModel = modelOptions.some((o) => o.value === model) ? model : '';

  const currentHeld = useMemo(() => {
    if (!effectiveSalesperson || !effectiveDesign || !effectiveModel) return null;
    return computeHeldQty(data.samples, effectiveSalesperson, effectiveDesign, effectiveModel);
  }, [data.samples, effectiveSalesperson, effectiveDesign, effectiveModel]);

  const stepValue = (current: string, delta: number, min: number) => {
    Haptics.selectionAsync().catch(() => {});
    const parsed = parseInt(current, 10);
    const base = Number.isNaN(parsed) ? 0 : parsed;
    return String(Math.max(min, base + delta));
  };

  const handleSave = async () => {
    if (!effectiveSalesperson || !effectiveDesign || !effectiveModel || !date) {
      setFeedback({
        text: 'Please select salesperson, date, design, and model number.',
        tone: 'bad',
      });
      return;
    }

    const trimmedQty = qtyInput.trim();
    const qty = Number(trimmedQty);
    if (!trimmedQty || !Number.isInteger(qty) || qty < 1) {
      setFeedback({ text: 'Quantity must be a whole number of 1 or more.', tone: 'bad' });
      return;
    }

    const trimmedTrays = traysInput.trim();
    const trays = trimmedTrays === '' ? null : Number(trimmedTrays);
    if (trays !== null && (!Number.isInteger(trays) || trays < 0)) {
      setFeedback({ text: 'No. of trays must be a whole number of 0 or more.', tone: 'bad' });
      return;
    }

    if (status === 'Returned' || status === 'Converted to sale') {
      const held = computeHeldQty(
        data.samples,
        effectiveSalesperson,
        effectiveDesign,
        effectiveModel,
      );
      if (qty > held) {
        setFeedback({
          text: `Cannot mark ${qty} as ${status.toLowerCase()}: ${effectiveSalesperson} holds ${held} unit(s) of ${effectiveModel}.`,
          tone: 'bad',
        });
        return;
      }
    }

    setSaving(true);
    try {
      const ok = await onAddRecord({
        id: uid('rec'),
        date,
        salesperson: effectiveSalesperson,
        design: effectiveDesign,
        item: effectiveModel,
        qty,
        trays,
        status,
        notes: notes.trim(),
        ts: Date.now(),
      });

      if (ok === false) return;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setModel('');
      setQtyInput('1');
      setTraysInput('');
      setNotes('');
      setFeedback({ text: 'Sample record saved.', tone: 'ok' });
      setTimeout(() => {
        setFeedback((cur) => (cur?.text === 'Sample record saved.' ? null : cur));
      }, 3000);
    } finally {
      setSaving(false);
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
        {/* 1. Who & when */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>1. Who &amp; When</Text>

          <Text style={styles.label}>Salesperson</Text>
          <Pressable
            onPress={() => setPickerKind('salesperson')}
            style={styles.selectBtn}
          >
            <Text
              style={[
                styles.selectText,
                !effectiveSalesperson && styles.selectPlaceholder,
              ]}
            >
              {effectiveSalesperson || 'Select salesperson…'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
          </Pressable>

          <Text style={styles.label}>Date</Text>
          <Pressable
            onPress={() => setDateModalOpen(true)}
            style={styles.selectBtn}
          >
            <Text style={styles.selectText}>{formatDateDisplay(date) || date}</Text>
            <Ionicons name="calendar-outline" size={18} color={COLORS.textMuted} />
          </Pressable>
        </View>

        {/* 2. What was given */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>2. What Was Given</Text>

          <Text style={styles.label}>Design</Text>
          <Pressable
            onPress={() => setPickerKind('design')}
            style={styles.selectBtn}
          >
            <Text
              style={[styles.selectText, !effectiveDesign && styles.selectPlaceholder]}
            >
              {effectiveDesign || 'Select design…'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
          </Pressable>

          <Text style={styles.label}>Model number</Text>
          <Pressable
            onPress={() => {
              if (!effectiveDesign) return;
              setPickerKind('model');
            }}
            style={[styles.selectBtn, !effectiveDesign && styles.selectDisabled]}
          >
            <Text
              style={[styles.selectText, !effectiveModel && styles.selectPlaceholder]}
            >
              {effectiveModel ||
                (effectiveDesign ? 'Select model number…' : 'Choose a design first')}
            </Text>
            <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
          </Pressable>

          {currentHeld !== null && (
            <Text style={styles.heldHint}>
              Currently with {effectiveSalesperson}: {currentHeld} unit
              {currentHeld === 1 ? '' : 's'}
            </Text>
          )}

          {designOptions.length === 0 && (
            <Pressable onPress={onGoToManage} style={styles.linkBtn}>
              <Text style={styles.linkText}>Add designs &amp; models in Manage Lists →</Text>
            </Pressable>
          )}
        </View>

        {/* 3. How many */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>3. How Many</Text>

          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Quantity</Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => setQtyInput((v) => stepValue(v, -1, 1))}
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </Pressable>
                <TextInput
                  value={qtyInput}
                  onChangeText={setQtyInput}
                  keyboardType="number-pad"
                  style={styles.stepInput}
                />
                <Pressable
                  onPress={() => setQtyInput((v) => stepValue(v, 1, 1))}
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.col}>
              <Text style={styles.label}>No. of trays</Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => setTraysInput((v) => stepValue(v, -1, 0))}
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </Pressable>
                <TextInput
                  value={traysInput}
                  onChangeText={setTraysInput}
                  placeholder="0"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="number-pad"
                  style={styles.stepInput}
                />
                <Pressable
                  onPress={() => setTraysInput((v) => stepValue(v, 1, 0))}
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        {/* 4. Status & Notes */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>4. Status &amp; Notes</Text>
          <View style={styles.segList}>
            {STATUS_OPTIONS.map((opt) => {
              const active = status === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setStatus(opt);
                  }}
                  style={[styles.segBtn, active && styles.segBtnActive]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything worth remembering"
            placeholderTextColor={COLORS.textMuted}
            style={styles.notesInput}
          />
        </View>

        {feedback && (
          <View
            style={[
              styles.feedbackBox,
              feedback.tone === 'ok' ? styles.feedbackOk : styles.feedbackBad,
            ]}
          >
            <Text
              style={[
                styles.feedbackText,
                feedback.tone === 'ok' ? styles.feedbackTextOk : styles.feedbackTextBad,
              ]}
            >
              {feedback.text}
            </Text>
          </View>
        )}

        <Pressable disabled={saving} onPress={handleSave} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Record'}</Text>
        </Pressable>
      </ScrollView>

      <PickerSheet
        visible={pickerKind === 'salesperson'}
        title="Select Salesperson"
        options={salespeopleOptions}
        selectedValue={effectiveSalesperson}
        emptyMessage="No salespeople yet. Add them in Manage Lists."
        onSelect={setSalesperson}
        onClose={() => setPickerKind(null)}
      />

      <PickerSheet
        visible={pickerKind === 'design'}
        title="Select Design"
        options={designOptions}
        selectedValue={effectiveDesign}
        emptyMessage="No designs yet. Add them in Manage Lists."
        onSelect={(val) => {
          setDesign(val);
          setModel('');
        }}
        onClose={() => setPickerKind(null)}
      />

      <PickerSheet
        visible={pickerKind === 'model'}
        title="Select Model Number"
        options={modelOptions}
        selectedValue={effectiveModel}
        emptyMessage="No model numbers under this design yet."
        onSelect={setModel}
        onClose={() => setPickerKind(null)}
      />

      <DateModal
        visible={dateModalOpen}
        value={date}
        onSelect={setDate}
        onClose={() => setDateModalOpen(false)}
      />
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
    gap: 14,
  },
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: 14,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 4,
  },
  selectBtn: {
    minHeight: 48,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
  },
  selectDisabled: {
    backgroundColor: COLORS.surfaceSoft,
    opacity: 0.7,
  },
  selectText: {
    fontSize: 15,
    color: COLORS.text,
  },
  selectPlaceholder: {
    color: COLORS.textMuted,
  },
  heldHint: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  linkBtn: {
    paddingVertical: 6,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 12,
  },
  col: {
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  stepBtn: {
    width: 46,
    height: 48,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceSoft,
  },
  stepBtnText: {
    fontSize: 22,
    fontWeight: '600',
    color: COLORS.text,
  },
  stepInput: {
    flex: 1,
    height: 48,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  segList: {
    gap: 8,
    marginTop: 2,
  },
  segBtn: {
    minHeight: 46,
    borderRadius: RADII.sm,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  segBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primarySoft,
  },
  segText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  segTextActive: {
    color: COLORS.primary,
  },
  notesInput: {
    minHeight: 48,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 12,
    fontSize: 15,
    color: COLORS.text,
    marginTop: 2,
  },
  feedbackBox: {
    borderRadius: RADII.sm,
    padding: 12,
    borderWidth: 1,
  },
  feedbackOk: {
    backgroundColor: COLORS.convertedBg,
    borderColor: '#a7f3d0',
  },
  feedbackBad: {
    backgroundColor: COLORS.dangerSoft,
    borderColor: '#fecaca',
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackTextOk: {
    color: COLORS.convertedText,
  },
  feedbackTextBad: {
    color: COLORS.danger,
  },
  saveBtn: {
    height: 52,
    borderRadius: RADII.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
});
