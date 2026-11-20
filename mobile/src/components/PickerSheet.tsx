import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADII } from '../theme';

export interface PickerOption {
  label: string;
  value: string;
}

interface PickerSheetProps {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedValue: string;
  allowAllOption?: boolean;
  allLabel?: string;
  emptyMessage?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export default function PickerSheet({
  visible,
  title,
  options,
  selectedValue,
  allowAllOption = false,
  allLabel = 'All',
  emptyMessage = 'No options available yet.',
  onSelect,
  onClose,
}: PickerSheetProps) {
  const [filter, setFilter] = useState('');

  const filteredOptions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = allowAllOption ? [{ label: allLabel, value: '' }, ...options] : options;
    if (!q) return base;
    return base.filter((o) => o.label.toLowerCase().includes(q));
  }, [allowAllOption, allLabel, filter, options]);

  const handleClose = () => {
    setFilter('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={handleClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close picker"
            >
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </Pressable>
          </View>

          {options.length > 6 && (
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={COLORS.textMuted} />
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Filter list…"
                placeholderTextColor={COLORS.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
              />
            </View>
          )}

          {filteredOptions.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{emptyMessage}</Text>
            </View>
          ) : (
            <FlatList
              data={filteredOptions}
              keyExtractor={(item) => item.value || '__all__'}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = item.value === selectedValue;
                return (
                  <Pressable
                    onPress={() => {
                      setFilter('');
                      onSelect(item.value);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      isSelected && styles.rowSelected,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
                      {item.label}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={20} color={COLORS.primary} />
                    )}
                  </Pressable>
                );
              }}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADII.lg,
    borderTopRightRadius: RADII.lg,
    maxHeight: '78%',
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  list: {
    marginTop: 4,
  },
  row: {
    minHeight: 50,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  rowSelected: {
    backgroundColor: COLORS.primarySoft,
  },
  rowPressed: {
    backgroundColor: COLORS.surfaceSoft,
  },
  rowText: {
    fontSize: 15,
    color: COLORS.text,
  },
  rowTextSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  emptyBox: {
    padding: 28,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
