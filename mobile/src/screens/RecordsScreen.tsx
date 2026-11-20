import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import EditRecordModal from '../components/EditRecordModal';
import PickerSheet from '../components/PickerSheet';
import { COLORS, RADII } from '../theme';
import { AppData, SampleRecord } from '../types/stock';
import {
  buildCsvContent,
  ci,
  formatDateDisplay,
  mk,
  nk,
  signForStatus,
} from '../utils/stockUtils';

interface RecordsScreenProps {
  data: AppData;
  refreshing?: boolean;
  onRefresh?: () => Promise<void> | void;
  onUpdateRecord: (updated: SampleRecord) => Promise<boolean> | boolean | void;
  onDeleteRecord: (id: string) => Promise<boolean> | boolean | void;
  onGoToNewRecord: () => void;
}

interface ItemSummary {
  key: string;
  model: string;
  design: string;
  sentQty: number;
  outQty: number;
  sentTrays: number;
  outTrays: number;
  hasSearchMatch: boolean;
}

interface PersonGroup {
  key: string;
  name: string;
  units: number;
  trays: number;
  items: ItemSummary[];
  allHistory: SampleRecord[];
  matchedHistory: SampleRecord[];
}

export default function RecordsScreen({
  data,
  refreshing = false,
  onRefresh,
  onUpdateRecord,
  onDeleteRecord,
  onGoToNewRecord,
}: RecordsScreenProps) {
  const [search, setSearch] = useState('');
  const [filterSp, setFilterSp] = useState('');
  const [spPickerOpen, setSpPickerOpen] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [editingRecord, setEditingRecord] = useState<SampleRecord | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, []);

  const filterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of data.samples) {
      const k = nk(e.salesperson);
      if (k && !map.has(k)) map.set(k, e.salesperson.trim());
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => ci(a.label, b.label));
  }, [data.samples]);

  const effectiveFilterSp = useMemo(() => {
    if (!filterSp) return '';
    return filterOptions.some((o) => o.value === filterSp) ? filterSp : '';
  }, [filterOptions, filterSp]);

  const selectedFilterLabel = useMemo(() => {
    if (!effectiveFilterSp) return 'All salespeople';
    return filterOptions.find((o) => o.value === effectiveFilterSp)?.label || 'All salespeople';
  }, [effectiveFilterSp, filterOptions]);

  const stats = useMemo(() => {
    const people = new Set<string>();
    let units = 0;
    let trays = 0;
    for (const e of data.samples) {
      const k = nk(e.salesperson);
      if (k) people.add(k);
      const sg = signForStatus(e.status);
      units += sg * (Number(e.qty) || 0);
      trays += sg * (Number(e.trays) || 0);
    }
    return { records: data.samples.length, units, trays, salespeople: people.size };
  }, [data.samples]);

  const query = search.trim().toLowerCase();

  const matchesQuery = (e: SampleRecord, q: string) => {
    if (!q) return true;
    return [
      e.salesperson,
      e.item,
      e.design,
      e.notes,
      e.status,
      e.date,
      formatDateDisplay(e.date),
      e.by ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(q);
  };

  const peopleGroups = useMemo<PersonGroup[]>(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        units: number;
        trays: number;
        itemMap: Map<string, ItemSummary>;
        allHistory: SampleRecord[];
        matchedHistory: SampleRecord[];
      }
    >();
    const labelMap = new Map(filterOptions.map((o) => [o.value, o.label]));

    for (const e of data.samples) {
      const k = nk(e.salesperson);
      if (!k) continue;
      if (effectiveFilterSp && k !== effectiveFilterSp) continue;

      let group = map.get(k);
      if (!group) {
        group = {
          key: k,
          name: labelMap.get(k) || e.salesperson.trim(),
          units: 0,
          trays: 0,
          itemMap: new Map(),
          allHistory: [],
          matchedHistory: [],
        };
        map.set(k, group);
      }

      const itemKey = mk(e.design, e.item);
      let item = group.itemMap.get(itemKey);
      if (!item) {
        item = {
          key: itemKey,
          model: e.item,
          design: e.design,
          sentQty: 0,
          outQty: 0,
          sentTrays: 0,
          outTrays: 0,
          hasSearchMatch: false,
        };
        group.itemMap.set(itemKey, item);
      }

      const sg = signForStatus(e.status);
      const qn = Number(e.qty) || 0;
      const tn = Number(e.trays) || 0;
      if (sg > 0) {
        item.sentQty += qn;
        item.sentTrays += tn;
      } else {
        item.outQty += qn;
        item.outTrays += tn;
      }

      group.units += sg * qn;
      group.trays += sg * tn;
      group.allHistory.push(e);

      if (matchesQuery(e, query)) {
        group.matchedHistory.push(e);
        item.hasSearchMatch = true;
      }
    }

    const sortHist = (arr: SampleRecord[]) =>
      arr.slice().sort((a, b) => {
        if (a.date !== b.date) return b.date < a.date ? -1 : 1;
        return (b.ts || 0) - (a.ts || 0);
      });

    return Array.from(map.values())
      .filter((g) => !query || g.matchedHistory.length > 0)
      .map((g) => ({
        key: g.key,
        name: g.name,
        units: g.units,
        trays: g.trays,
        items: Array.from(g.itemMap.values())
          .filter((i) => !query || i.hasSearchMatch)
          .sort((a, b) => b.sentQty - b.outQty - (a.sentQty - a.outQty)),
        allHistory: sortHist(g.allHistory),
        matchedHistory: sortHist(g.matchedHistory),
      }))
      .sort((a, b) => b.units - a.units);
  }, [data.samples, effectiveFilterSp, filterOptions, query]);

  const handleExportCsv = async () => {
    try {
      const records = peopleGroups.flatMap((g) => g.matchedHistory);
      const csv = buildCsvContent(records);
      const uri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}sample-stock-log.csv`;
      await FileSystem.writeAsStringAsync(uri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export Sample Stock Log CSV',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('CSV Saved', `Exported ${records.length} records to ${uri}`);
      }
    } catch (err) {
      Alert.alert('Export Failed', err instanceof Error ? err.message : 'Unable to export CSV.');
    }
  };

  const handleTwoTapDelete = (id: string) => {
    if (armedDeleteId !== id) {
      Haptics.selectionAsync().catch(() => {});
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setArmedDeleteId(id);
      armTimerRef.current = setTimeout(() => {
        setArmedDeleteId((cur) => (cur === id ? null : cur));
      }, 4000);
      return;
    }

    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    setArmedDeleteId(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    onDeleteRecord(id);
  };

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      {/* 2x2 KPI Grid */}
      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Records</Text>
          <Text style={styles.kpiValue}>{stats.records}</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Units Out</Text>
          <Text style={styles.kpiValue}>{stats.units}</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Trays Out</Text>
          <Text style={styles.kpiValue}>{stats.trays}</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Salespeople</Text>
          <Text style={styles.kpiValue}>{stats.salespeople}</Text>
        </View>
      </View>

      {/* Search & Filter Bar */}
      <View style={styles.filterCard}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={COLORS.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search salesperson, model, design, status…"
            placeholderTextColor={COLORS.textMuted}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setSpPickerOpen(true)}
            style={styles.filterBtn}
          >
            <Text style={styles.filterBtnText} numberOfLines={1}>
              {selectedFilterLabel}
            </Text>
            <Ionicons name="chevron-down" size={16} color={COLORS.textMuted} />
          </Pressable>

          <Pressable onPress={handleExportCsv} style={styles.exportBtn}>
            <Ionicons name="share-outline" size={16} color={COLORS.text} />
            <Text style={styles.exportBtnText}>Export CSV</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={peopleGroups}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {data.samples.length === 0 ? 'No sample records yet' : 'No matching records'}
            </Text>
            <Text style={styles.emptySub}>
              {data.samples.length === 0
                ? 'Log your first sample dispatch to start tracking units and trays.'
                : 'Try clearing your search or salesperson filter.'}
            </Text>
            {data.samples.length === 0 && (
              <Pressable onPress={onGoToNewRecord} style={styles.emptyCta}>
                <Text style={styles.emptyCtaText}>Log First Sample</Text>
              </Pressable>
            )}
          </View>
        }
        renderItem={({ item: person }) => {
          const isOpen =
            !!expandedHistory[person.key] || (!!query && person.matchedHistory.length > 0);
          return (
            <View style={styles.personCard}>
              <View style={styles.personHeader}>
                <View style={styles.personIdentity}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {person.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.personName}>{person.name}</Text>
                </View>
                <Text style={styles.personTotals}>
                  <Text style={styles.personTotalsBold}>{person.units}</Text> units ·{' '}
                  <Text style={styles.personTotalsBold}>{person.trays}</Text> trays
                </Text>
              </View>

              {person.items.map((it) => {
                const held = it.sentQty - it.outQty;
                const heldTrays = it.sentTrays - it.outTrays;
                return (
                  <View
                    key={it.key}
                    style={[styles.itemRow, held <= 0 && styles.itemRowZero]}
                  >
                    <View style={styles.itemLeft}>
                      <Text style={styles.itemModel}>{it.model}</Text>
                      {!!it.design && <Text style={styles.itemDesign}>· {it.design}</Text>}
                    </View>
                    <View style={styles.itemRight}>
                      <Text style={styles.itemHeld}>
                        <Text style={styles.itemHeldNum}>{held}</Text> with them
                      </Text>
                      {heldTrays !== 0 && (
                        <Text style={styles.itemTrays}>
                          {heldTrays} tray{Math.abs(heldTrays) === 1 ? '' : 's'}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}

              <Pressable
                onPress={() =>
                  setExpandedHistory((prev) => ({ ...prev, [person.key]: !prev[person.key] }))
                }
                style={styles.historyToggle}
              >
                <Text style={styles.historyToggleText}>
                  History ({person.matchedHistory.length}
                  {query && person.matchedHistory.length !== person.allHistory.length
                    ? ` of ${person.allHistory.length}`
                    : ''}{' '}
                  {person.matchedHistory.length === 1 ? 'entry' : 'entries'})
                </Text>
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={COLORS.textMuted}
                />
              </Pressable>

              {isOpen && (
                <View style={styles.historyList}>
                  {person.matchedHistory.map((entry) => {
                    const statusColor =
                      entry.status === 'Sent'
                        ? COLORS.sentText
                        : entry.status === 'Returned'
                          ? COLORS.returnedText
                          : COLORS.convertedText;
                    const armed = armedDeleteId === entry.id;
                    return (
                      <View key={entry.id} style={styles.historyRow}>
                        <View style={styles.historyInfo}>
                          <Text style={styles.historyPrimary}>
                            {formatDateDisplay(entry.date)} · {entry.item} ({entry.design}) · ×
                            {entry.qty}
                            {entry.trays != null ? ` · ${entry.trays} trays` : ''}
                          </Text>
                          <Text style={styles.historyMeta}>
                            <Text style={{ color: statusColor, fontWeight: '700' }}>
                              {entry.status}
                            </Text>
                            {entry.notes ? ` · ${entry.notes}` : ''}
                            {entry.by ? ` · by ${entry.by}` : ''}
                          </Text>
                        </View>
                        <View style={styles.historyActions}>
                          <Pressable
                            onPress={() => setEditingRecord(entry)}
                            hitSlop={8}
                            style={styles.actionBtn}
                          >
                            <Text style={styles.editText}>Edit</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleTwoTapDelete(entry.id)}
                            hitSlop={8}
                            style={styles.actionBtn}
                          >
                            <Text style={[styles.delText, armed && styles.delTextArmed]}>
                              {armed ? 'Tap again' : 'Delete'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }}
      />

      <PickerSheet
        visible={spPickerOpen}
        title="Filter by Salesperson"
        options={filterOptions}
        selectedValue={effectiveFilterSp}
        allowAllOption
        allLabel="All salespeople"
        onSelect={setFilterSp}
        onClose={() => setSpPickerOpen(false)}
      />

      <EditRecordModal
        record={editingRecord}
        allSamples={data.samples}
        onSave={onUpdateRecord}
        onClose={() => setEditingRecord(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  listContent: {
    padding: 16,
    paddingBottom: 28,
    gap: 12,
  },
  headerBlock: {
    gap: 12,
    marginBottom: 4,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    width: '48.5%',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  filterCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: 12,
    gap: 10,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
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
  filterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  filterBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
  },
  filterBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 6,
  },
  exportBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
  },
  exportBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  personCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  personHeader: {
    backgroundColor: COLORS.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  personIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.primaryText,
    fontWeight: '700',
    fontSize: 15,
  },
  personName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    flexShrink: 1,
  },
  personTotals: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontVariant: ['tabular-nums'],
  },
  personTotalsBold: {
    fontWeight: '700',
    color: COLORS.text,
  },
  itemRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemRowZero: {
    opacity: 0.55,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    flex: 1,
    gap: 6,
  },
  itemModel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  itemDesign: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  itemRight: {
    alignItems: 'flex-end',
  },
  itemHeld: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontVariant: ['tabular-nums'],
  },
  itemHeldNum: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  itemTrays: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontVariant: ['tabular-nums'],
  },
  historyToggle: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  historyList: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  historyRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  historyInfo: {
    flex: 1,
    gap: 2,
  },
  historyPrimary: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  historyMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  historyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionBtn: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  editText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  delText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.danger,
  },
  delTextArmed: {
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  emptySub: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  emptyCta: {
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
  },
  emptyCtaText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
});
