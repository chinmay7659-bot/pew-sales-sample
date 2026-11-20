import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { SampleRecord, SampleStatus } from '../types/stock';
import { COLORS, RADII } from '../theme';
import { computeHeldQty, formatDateDisplay } from '../utils/stockUtils';
import DateModal from './DateModal';

interface EditRecordModalProps {
  record: SampleRecord | null;
  allSamples: SampleRecord[];
  onSave: (updated: SampleRecord) => Promise<boolean> | boolean | void;
  onClose: () => void;
}

const STATUSES: SampleStatus[] = ['Sent', 'Returned', 'Converted to sale'];

export default function EditRecordModal({
  record,
  allSamples,
  onSave,
  onClose,
}: EditRecordModalProps) {
  const [date, setDate] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const [traysInput, setTraysInput] = useState('');
  const [status, setStatus] = useState<SampleStatus>('Sent');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateModalOpen, setDateModalOpen] = useState(false);

  useEffect(() => {
    if (record) {
      setDate(record.date);
      setQtyInput(String(record.qty));
      setTraysInput(record.trays == null ? '' : String(record.trays));
      setStatus(record.status);
      setNotes(record.notes);
      setError(null);
    }
  }, [record]);

  if (!record) return null;

  const stepVal = (cur: string, delta: number, min: number) => {
    const n = parseInt(cur, 10);
    const base = Number.isNaN(n) ? 0 : n;
    return String(Math.max(min, base + delta));
  };

  const handleSave = async () => {
    if (!date) {
      setError('Date is required.');
      return;
    }
    const qty = Number(qtyInput.trim());
    if (!qtyInput.trim() || !Number.isInteger(qty) || qty < 1) {
      setError('Quantity must be a whole number of 1 or more.');
      return;
    }
    const trimmedTrays = traysInput.trim();
    const trays = trimmedTrays === '' ? null : Number(trimmedTrays);
    if (trays !== null && (!Number.isInteger(trays) || trays < 0)) {
      setError('No. of trays must be a whole number of 0 or more.');
      return;
    }

    if (status === 'Returned' || status === 'Converted to sale') {
      const heldExcluding = computeHeldQty(
        allSamples,
        record.salesperson,
        record.design,
        record.item,
        record.id,
      );
      if (qty > heldExcluding) {
        setError(
          `Cannot mark ${qty} as ${status.toLowerCase()}: ${record.salesperson} holds ${heldExcluding} unit(s) excluding this entry.`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      const ok = await onSave({
        ...record,
        date,
        qty,
        trays,
        status,
        notes: notes.trim(),
      });
      if (ok !== false) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!record} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Edit Record</Text>
              <Text style={styles.subtitle}>
                {record.salesperson} · {record.item} ({record.design})
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Date</Text>
            <Pressable onPress={() => setDateModalOpen(true)} style={styles.selectBtn}>
              <Text style={styles.selectText}>{formatDateDisplay(date) || date}</Text>
            </Pressable>

            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.label}>Quantity</Text>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => setQtyInput((v) => stepVal(v, -1, 1))}
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
                    onPress={() => setQtyInput((v) => stepVal(v, 1, 1))}
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
                    onPress={() => setTraysInput((v) => stepVal(v, -1, 0))}
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
                    onPress={() => setTraysInput((v) => stepVal(v, 1, 0))}
                    style={styles.stepBtn}
                  >
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <Text style={styles.label}>Status</Text>
            <View style={styles.segRow}>
              {STATUSES.map((opt) => {
                const active = status === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setStatus(opt)}
                    style={[styles.segBtn, active && styles.segBtnActive]}
                  >
                    <Text style={[styles.segText, active && styles.segTextActive]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable disabled={saving} onPress={handleSave} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <DateModal
        visible={dateModalOpen}
        value={date}
        onSelect={setDate}
        onClose={() => setDateModalOpen(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADII.lg,
    borderTopRightRadius: RADII.lg,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  closeText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  body: {
    padding: 18,
    gap: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  selectBtn: {
    height: 46,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  selectText: {
    fontSize: 15,
    color: COLORS.text,
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
  },
  stepBtn: {
    width: 44,
    height: 46,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceSoft,
  },
  stepBtnText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  stepInput: {
    flex: 1,
    height: 46,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  segRow: {
    gap: 8,
  },
  segBtn: {
    minHeight: 44,
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
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  segTextActive: {
    color: COLORS.primary,
  },
  input: {
    height: 46,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  error: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.danger,
  },
  saveBtn: {
    height: 50,
    borderRadius: RADII.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
});
