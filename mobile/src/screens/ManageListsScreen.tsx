import { useEffect, useMemo, useRef, useState } from 'react';
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
import PickerSheet from '../components/PickerSheet';
import { COLORS, RADII } from '../theme';
import { AppData, DesignItem, ModelItem, SalespersonItem } from '../types/stock';
import { ci, mk, nk, uid } from '../utils/stockUtils';

export interface MobileCatalogHandlers {
  onImportMissing: (entries: {
    salespeople: SalespersonItem[];
    designs: DesignItem[];
    models: ModelItem[];
  }) => Promise<boolean>;
  onAddSalesperson: (item: SalespersonItem) => Promise<boolean>;
  onAddDesign: (item: DesignItem) => Promise<boolean>;
  onAddModel: (item: ModelItem) => Promise<boolean>;
  onRenameSalesperson: (id: string, oldName: string, newName: string) => Promise<boolean>;
  onRenameDesign: (id: string, oldName: string, newName: string) => Promise<boolean>;
  onRenameModel: (
    id: string,
    oldDesign: string,
    oldName: string,
    newDesign: string,
    newName: string,
  ) => Promise<boolean>;
  onDeleteCatalogItem: (
    kind: 'salesperson' | 'design' | 'model',
    id: string,
  ) => Promise<boolean>;
}

interface ManageListsScreenProps {
  data: AppData;
  catalogHandlers: MobileCatalogHandlers;
}

type ListTab = 'salespeople' | 'designs' | 'models';

type EditingTarget =
  | { kind: 'salesperson'; id: string; name: string }
  | { kind: 'design'; id: string; name: string }
  | { kind: 'model'; id: string; name: string; design: string }
  | null;

export default function ManageListsScreen({ data, catalogHandlers }: ManageListsScreenProps) {
  const [tab, setTab] = useState<ListTab>('salespeople');
  const [newSp, setNewSp] = useState('');
  const [newDesign, setNewDesign] = useState('');
  const [newModelDesign, setNewModelDesign] = useState('');
  const [newModel, setNewModel] = useState('');

  const [editing, setEditing] = useState<EditingTarget>(null);
  const [designPickerFor, setDesignPickerFor] = useState<'add-model' | 'edit-model' | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [armedDeleteKey, setArmedDeleteKey] = useState<string | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, []);

  const showMsg = (text: string, tone: 'ok' | 'bad') => setFeedback({ text, tone });

  const merged = useMemo(() => {
    const spMap = new Map<string, { name: string; item?: SalespersonItem; recordCount: number }>();
    const dnMap = new Map<
      string,
      { name: string; item?: DesignItem; modelCount: number; recordCount: number }
    >();
    const mdMap = new Map<
      string,
      { name: string; design: string; item?: ModelItem; recordCount: number }
    >();

    for (const s of data.samples) {
      const sk = nk(s.salesperson);
      if (sk) {
        const cur = spMap.get(sk) || { name: s.salesperson.trim(), recordCount: 0 };
        cur.recordCount += 1;
        spMap.set(sk, cur);
      }

      const dk = nk(s.design);
      if (dk) {
        const curD = dnMap.get(dk) || { name: s.design.trim(), modelCount: 0, recordCount: 0 };
        curD.recordCount += 1;
        dnMap.set(dk, curD);

        if (nk(s.item)) {
          const mkey = mk(s.design, s.item);
          const curM = mdMap.get(mkey) || {
            name: s.item.trim(),
            design: s.design.trim(),
            recordCount: 0,
          };
          curM.recordCount += 1;
          mdMap.set(mkey, curM);
        }
      }
    }

    for (const sp of data.salespeople) {
      const sk = nk(sp.name);
      if (!sk) continue;
      const cur = spMap.get(sk);
      spMap.set(sk, { name: sp.name, item: sp, recordCount: cur?.recordCount || 0 });
    }

    for (const dn of data.designs) {
      const dk = nk(dn.name);
      if (!dk) continue;
      const cur = dnMap.get(dk);
      dnMap.set(dk, {
        name: dn.name,
        item: dn,
        modelCount: 0,
        recordCount: cur?.recordCount || 0,
      });
    }

    for (const md of data.models) {
      const dk = nk(md.design);
      if (dk && !dnMap.has(dk)) {
        dnMap.set(dk, { name: md.design.trim(), modelCount: 0, recordCount: 0 });
      }
      const mkey = mk(md.design, md.name);
      const cur = mdMap.get(mkey);
      mdMap.set(mkey, {
        name: md.name,
        design: md.design,
        item: md,
        recordCount: cur?.recordCount || 0,
      });
    }

    for (const md of mdMap.values()) {
      const dEntry = dnMap.get(nk(md.design));
      if (dEntry) dEntry.modelCount += 1;
    }

    const salespeople = Array.from(spMap.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => ci(a.name, b.name));

    const designs = Array.from(dnMap.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => ci(a.name, b.name));

    const models = Array.from(mdMap.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => ci(a.name, b.name));

    const missingCount =
      salespeople.filter((x) => !x.item).length +
      designs.filter((x) => !x.item).length +
      models.filter((x) => !x.item).length;

    return { spMap, dnMap, mdMap, salespeople, designs, models, missingCount };
  }, [data]);

  const effectiveNewModelDesign = merged.designs.some((d) => d.name === newModelDesign)
    ? newModelDesign
    : '';

  const designPickerOptions = useMemo(
    () => merged.designs.map((d) => ({ label: d.name, value: d.name })),
    [merged.designs],
  );

  const handleImportAll = async () => {
    const now = Date.now();
    const existingSp = new Set(data.salespeople.map((x) => nk(x.name)));
    const existingDn = new Set(data.designs.map((x) => nk(x.name)));
    const existingMd = new Set(data.models.map((x) => mk(x.design, x.name)));

    const addSp: SalespersonItem[] = [];
    const addDn: DesignItem[] = [];
    const addMd: ModelItem[] = [];

    for (const s of merged.salespeople) {
      if (!s.item && !existingSp.has(s.key)) {
        existingSp.add(s.key);
        addSp.push({ id: uid('sp'), name: s.name, ts: now });
      }
    }
    for (const d of merged.designs) {
      if (!d.item && !existingDn.has(d.key)) {
        existingDn.add(d.key);
        addDn.push({ id: uid('dn'), name: d.name, ts: now });
      }
    }
    for (const m of merged.models) {
      if (!m.item && !existingMd.has(m.key)) {
        existingMd.add(m.key);
        addMd.push({ id: uid('md'), name: m.name, design: m.design, ts: now });
      }
    }
    const ok = await catalogHandlers.onImportMissing({
      salespeople: addSp,
      designs: addDn,
      models: addMd,
    });
    if (ok) showMsg('Imported items from records into editable lists.', 'ok');
  };

  const handleAddSalesperson = async () => {
    const trimmed = newSp.trim();
    if (!trimmed) return showMsg('Type a salesperson name first.', 'bad');
    if (merged.spMap.has(nk(trimmed))) return showMsg('Salesperson already exists.', 'bad');
    const ok = await catalogHandlers.onAddSalesperson({ id: uid('sp'), name: trimmed, ts: Date.now() });
    if (ok) {
      setNewSp('');
      showMsg('Salesperson added.', 'ok');
    }
  };

  const handleAddDesign = async () => {
    const trimmed = newDesign.trim();
    if (!trimmed) return showMsg('Type a design name first.', 'bad');
    if (merged.dnMap.has(nk(trimmed))) return showMsg('Design already exists.', 'bad');
    const ok = await catalogHandlers.onAddDesign({ id: uid('dn'), name: trimmed, ts: Date.now() });
    if (ok) {
      setNewDesign('');
      showMsg('Design added.', 'ok');
    }
  };

  const handleAddModel = async () => {
    const trimmed = newModel.trim();
    if (!effectiveNewModelDesign) return showMsg('Select a design first.', 'bad');
    if (!trimmed) return showMsg('Type a model number first.', 'bad');
    if (merged.mdMap.has(mk(effectiveNewModelDesign, trimmed))) {
      return showMsg('That model number already exists under this design.', 'bad');
    }
    const ok = await catalogHandlers.onAddModel({
      id: uid('md'),
      name: trimmed,
      design: effectiveNewModelDesign,
      ts: Date.now(),
    });
    if (ok) {
      setNewModel('');
      showMsg('Model number added.', 'ok');
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const trimmedName = editing.name.trim();
    if (!trimmedName) return showMsg('Name cannot be empty.', 'bad');

    if (editing.kind === 'salesperson') {
      const existing = data.salespeople.find((s) => s.id === editing.id);
      if (!existing) return;
      const oldKey = nk(existing.name);
      const newKey = nk(trimmedName);
      if (newKey !== oldKey && merged.spMap.has(newKey)) {
        return showMsg('Another salesperson already has that name.', 'bad');
      }
      const ok = await catalogHandlers.onRenameSalesperson(existing.id, existing.name, trimmedName);
      if (ok) {
        setEditing(null);
        showMsg('Salesperson updated across list and records.', 'ok');
      }
      return;
    }

    if (editing.kind === 'design') {
      const existing = data.designs.find((d) => d.id === editing.id);
      if (!existing) return;
      const oldKey = nk(existing.name);
      const newKey = nk(trimmedName);
      if (newKey !== oldKey && merged.dnMap.has(newKey)) {
        return showMsg('Another design already has that name.', 'bad');
      }
      const ok = await catalogHandlers.onRenameDesign(existing.id, existing.name, trimmedName);
      if (ok) {
        setEditing(null);
        showMsg('Design updated across list, models, and records.', 'ok');
      }
      return;
    }

    const existing = data.models.find((m) => m.id === editing.id);
    if (!existing) return;
    const targetDesign = editing.design.trim();
    if (!targetDesign) return showMsg('Choose a design for this model.', 'bad');
    const oldPair = mk(existing.design, existing.name);
    const newPair = mk(targetDesign, trimmedName);
    if (newPair !== oldPair && merged.mdMap.has(newPair)) {
      return showMsg(`Model "${trimmedName}" already exists under "${targetDesign}".`, 'bad');
    }
    const ok = await catalogHandlers.onRenameModel(
      existing.id,
      existing.design,
      existing.name,
      targetDesign,
      trimmedName,
    );
    if (ok) {
      setEditing(null);
      showMsg('Model number updated across list and records.', 'ok');
    }
  };

  const handleTwoTapDelete = async (
    deleteKey: string,
    kind: 'salesperson' | 'design' | 'model',
    id: string,
    name: string,
    design?: string,
  ) => {
    if (armedDeleteKey !== deleteKey) {
      Haptics.selectionAsync().catch(() => {});
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setArmedDeleteKey(deleteKey);
      armTimerRef.current = setTimeout(() => {
        setArmedDeleteKey((cur) => (cur === deleteKey ? null : cur));
      }, 4000);
      return;
    }

    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    setArmedDeleteKey(null);

    if (kind === 'salesperson') {
      const key = nk(name);
      if (data.samples.some((r) => nk(r.salesperson) === key)) {
        return showMsg('Records still use this salesperson. Edit it or delete those records first.', 'bad');
      }
      const ok = await catalogHandlers.onDeleteCatalogItem('salesperson', id);
      if (ok) showMsg('Salesperson deleted.', 'ok');
      return;
    }

    if (kind === 'design') {
      const key = nk(name);
      if (merged.models.some((m) => nk(m.design) === key)) {
        return showMsg('Delete or move this design’s model numbers first.', 'bad');
      }
      if (data.samples.some((r) => nk(r.design) === key)) {
        return showMsg('Records still use this design. Edit it or delete those records first.', 'bad');
      }
      const ok = await catalogHandlers.onDeleteCatalogItem('design', id);
      if (ok) showMsg('Design deleted.', 'ok');
      return;
    }

    const pair = mk(design, name);
    if (data.samples.some((r) => mk(r.design, r.item) === pair)) {
      return showMsg('Records still use this model number. Edit it or delete those records first.', 'bad');
    }
    const ok = await catalogHandlers.onDeleteCatalogItem('model', id);
    if (ok) showMsg('Model number deleted.', 'ok');
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
        {merged.missingCount > 0 && (
          <View style={styles.importBanner}>
            <Text style={styles.importText}>
              {merged.missingCount} item(s) from records are not in your editable lists yet.
            </Text>
            <Pressable onPress={handleImportAll} style={styles.importBtn}>
              <Text style={styles.importBtnText}>Import all</Text>
            </Pressable>
          </View>
        )}

        {/* Segmented Tab Switch */}
        <View style={styles.segBar}>
          {(
            [
              { id: 'salespeople', label: 'Salespeople' },
              { id: 'designs', label: 'Designs' },
              { id: 'models', label: 'Models' },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  setTab(item.id);
                  setEditing(null);
                  setFeedback(null);
                }}
                style={[styles.segTab, active && styles.segTabActive]}
              >
                <Text style={[styles.segTabText, active && styles.segTabTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
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

        {tab === 'salespeople' && (
          <View style={styles.card}>
            <View style={styles.addRow}>
              <TextInput
                value={newSp}
                onChangeText={setNewSp}
                onSubmitEditing={handleAddSalesperson}
                placeholder="New salesperson name"
                placeholderTextColor={COLORS.textMuted}
                style={styles.addInput}
                returnKeyType="done"
              />
              <Pressable onPress={handleAddSalesperson} style={styles.addBtn}>
                <Text style={styles.addBtnText}>＋ Add</Text>
              </Pressable>
            </View>

            {merged.salespeople.length === 0 ? (
              <Text style={styles.emptyText}>No salespeople yet.</Text>
            ) : (
              merged.salespeople.map((sp) => {
                const isEditing = editing?.kind === 'salesperson' && editing.id === sp.item?.id;
                const delKey = `sp:${sp.key}`;

                if (isEditing && editing?.kind === 'salesperson') {
                  return (
                    <View key={sp.key} style={styles.editBlock}>
                      <TextInput
                        autoFocus
                        value={editing.name}
                        onChangeText={(t) => setEditing({ ...editing, name: t })}
                        onSubmitEditing={saveEdit}
                        style={styles.editInput}
                      />
                      {sp.recordCount > 0 && (
                        <Text style={styles.cascadeHint}>
                          Renaming updates {sp.recordCount} linked record(s)
                        </Text>
                      )}
                      <View style={styles.editActions}>
                        <Pressable onPress={saveEdit} style={styles.saveBtn}>
                          <Text style={styles.saveBtnText}>Save</Text>
                        </Pressable>
                        <Pressable onPress={() => setEditing(null)} style={styles.cancelBtn}>
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={sp.key} style={styles.listRow}>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName}>{sp.name}</Text>
                      <Text style={styles.rowMeta}>
                        {sp.recordCount} record{sp.recordCount === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <View style={styles.rowActions}>
                      {sp.item ? (
                        <>
                          <Pressable
                            onPress={() =>
                              setEditing({ kind: 'salesperson', id: sp.item!.id, name: sp.name })
                            }
                            style={styles.actionTouch}
                          >
                            <Text style={styles.editLink}>Edit</Text>
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              handleTwoTapDelete(delKey, 'salesperson', sp.item!.id, sp.name)
                            }
                            style={styles.actionTouch}
                          >
                            <Text
                              style={[
                                styles.deleteLink,
                                armedDeleteKey === delKey && styles.deleteLinkArmed,
                              ]}
                            >
                              {armedDeleteKey === delKey ? 'Tap again' : 'Delete'}
                            </Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          onPress={async () => {
                            const ok = await catalogHandlers.onAddSalesperson({
                              id: uid('sp'),
                              name: sp.name,
                              ts: Date.now(),
                            });
                            if (ok) showMsg(`Imported "${sp.name}" for editing.`, 'ok');
                          }}
                          style={styles.actionTouch}
                        >
                          <Text style={styles.editLink}>Import to edit</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {tab === 'designs' && (
          <View style={styles.card}>
            <View style={styles.addRow}>
              <TextInput
                value={newDesign}
                onChangeText={setNewDesign}
                onSubmitEditing={handleAddDesign}
                placeholder="New design name"
                placeholderTextColor={COLORS.textMuted}
                style={styles.addInput}
                returnKeyType="done"
              />
              <Pressable onPress={handleAddDesign} style={styles.addBtn}>
                <Text style={styles.addBtnText}>＋ Add</Text>
              </Pressable>
            </View>

            {merged.designs.length === 0 ? (
              <Text style={styles.emptyText}>No designs yet.</Text>
            ) : (
              merged.designs.map((dn) => {
                const isEditing = editing?.kind === 'design' && editing.id === dn.item?.id;
                const delKey = `dn:${dn.key}`;

                if (isEditing && editing?.kind === 'design') {
                  return (
                    <View key={dn.key} style={styles.editBlock}>
                      <TextInput
                        autoFocus
                        value={editing.name}
                        onChangeText={(t) => setEditing({ ...editing, name: t })}
                        onSubmitEditing={saveEdit}
                        style={styles.editInput}
                      />
                      {(dn.modelCount > 0 || dn.recordCount > 0) && (
                        <Text style={styles.cascadeHint}>
                          Updates {dn.modelCount} model(s) &amp; {dn.recordCount} record(s)
                        </Text>
                      )}
                      <View style={styles.editActions}>
                        <Pressable onPress={saveEdit} style={styles.saveBtn}>
                          <Text style={styles.saveBtnText}>Save</Text>
                        </Pressable>
                        <Pressable onPress={() => setEditing(null)} style={styles.cancelBtn}>
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={dn.key} style={styles.listRow}>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName}>{dn.name}</Text>
                      <Text style={styles.rowMeta}>
                        {dn.modelCount} model{dn.modelCount === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <View style={styles.rowActions}>
                      {dn.item ? (
                        <>
                          <Pressable
                            onPress={() =>
                              setEditing({ kind: 'design', id: dn.item!.id, name: dn.name })
                            }
                            style={styles.actionTouch}
                          >
                            <Text style={styles.editLink}>Edit</Text>
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              handleTwoTapDelete(delKey, 'design', dn.item!.id, dn.name)
                            }
                            style={styles.actionTouch}
                          >
                            <Text
                              style={[
                                styles.deleteLink,
                                armedDeleteKey === delKey && styles.deleteLinkArmed,
                              ]}
                            >
                              {armedDeleteKey === delKey ? 'Tap again' : 'Delete'}
                            </Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          onPress={async () => {
                            const ok = await catalogHandlers.onAddDesign({
                              id: uid('dn'),
                              name: dn.name,
                              ts: Date.now(),
                            });
                            if (ok) showMsg(`Imported "${dn.name}" for editing.`, 'ok');
                          }}
                          style={styles.actionTouch}
                        >
                          <Text style={styles.editLink}>Import to edit</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {tab === 'models' && (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Under design</Text>
            <Pressable
              onPress={() => setDesignPickerFor('add-model')}
              style={styles.selectBtn}
            >
              <Text
                style={[
                  styles.selectText,
                  !effectiveNewModelDesign && styles.selectPlaceholder,
                ]}
              >
                {effectiveNewModelDesign || 'Select design…'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
            </Pressable>

            <View style={[styles.addRow, { marginTop: 10 }]}>
              <TextInput
                value={newModel}
                onChangeText={setNewModel}
                onSubmitEditing={handleAddModel}
                placeholder="New model number"
                placeholderTextColor={COLORS.textMuted}
                style={styles.addInput}
                returnKeyType="done"
              />
              <Pressable onPress={handleAddModel} style={styles.addBtn}>
                <Text style={styles.addBtnText}>＋ Add</Text>
              </Pressable>
            </View>

            {merged.models.length === 0 ? (
              <Text style={styles.emptyText}>No model numbers yet.</Text>
            ) : (
              merged.designs.map((dn) => {
                const groupModels = merged.models.filter((m) => nk(m.design) === dn.key);
                if (groupModels.length === 0) return null;

                return (
                  <View key={dn.key} style={styles.groupWrap}>
                    <Text style={styles.groupHeader}>{dn.name}</Text>
                    {groupModels.map((md) => {
                      const isEditing = editing?.kind === 'model' && editing.id === md.item?.id;
                      const delKey = `md:${md.key}`;

                      if (isEditing && editing?.kind === 'model') {
                        return (
                          <View key={md.key} style={styles.editBlock}>
                            <TextInput
                              autoFocus
                              value={editing.name}
                              onChangeText={(t) => setEditing({ ...editing, name: t })}
                              placeholder="Model number"
                              style={styles.editInput}
                            />
                            <Pressable
                              onPress={() => setDesignPickerFor('edit-model')}
                              style={styles.selectBtn}
                            >
                              <Text style={styles.selectText}>{editing.design}</Text>
                              <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
                            </Pressable>
                            {md.recordCount > 0 && (
                              <Text style={styles.cascadeHint}>
                                Updates {md.recordCount} linked record(s)
                              </Text>
                            )}
                            <View style={styles.editActions}>
                              <Pressable onPress={saveEdit} style={styles.saveBtn}>
                                <Text style={styles.saveBtnText}>Save</Text>
                              </Pressable>
                              <Pressable onPress={() => setEditing(null)} style={styles.cancelBtn}>
                                <Text style={styles.cancelBtnText}>Cancel</Text>
                              </Pressable>
                            </View>
                          </View>
                        );
                      }

                      return (
                        <View key={md.key} style={styles.listRow}>
                          <View style={styles.rowInfo}>
                            <Text style={styles.rowName}>{md.name}</Text>
                            <Text style={styles.rowMeta}>
                              {md.recordCount} record{md.recordCount === 1 ? '' : 's'}
                            </Text>
                          </View>
                          <View style={styles.rowActions}>
                            {md.item ? (
                              <>
                                <Pressable
                                  onPress={() =>
                                    setEditing({
                                      kind: 'model',
                                      id: md.item!.id,
                                      name: md.name,
                                      design: md.design,
                                    })
                                  }
                                  style={styles.actionTouch}
                                >
                                  <Text style={styles.editLink}>Edit</Text>
                                </Pressable>
                                <Pressable
                                  onPress={() =>
                                    handleTwoTapDelete(
                                      delKey,
                                      'model',
                                      md.item!.id,
                                      md.name,
                                      md.design,
                                    )
                                  }
                                  style={styles.actionTouch}
                                >
                                  <Text
                                    style={[
                                      styles.deleteLink,
                                      armedDeleteKey === delKey && styles.deleteLinkArmed,
                                    ]}
                                  >
                                    {armedDeleteKey === delKey ? 'Tap again' : 'Delete'}
                                  </Text>
                                </Pressable>
                              </>
                            ) : (
                              <Pressable
                                onPress={async () => {
                                  const ok = await catalogHandlers.onAddModel({
                                    id: uid('md'),
                                    name: md.name,
                                    design: md.design,
                                    ts: Date.now(),
                                  });
                                  if (ok) showMsg(`Imported "${md.name}" for editing.`, 'ok');
                                }}
                                style={styles.actionTouch}
                              >
                                <Text style={styles.editLink}>Import to edit</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      <PickerSheet
        visible={designPickerFor !== null}
        title="Select Design"
        options={designPickerOptions}
        selectedValue={
          designPickerFor === 'edit-model' && editing?.kind === 'model'
            ? editing.design
            : effectiveNewModelDesign
        }
        emptyMessage="Add a design first under the Designs tab."
        onSelect={(val) => {
          if (designPickerFor === 'edit-model' && editing?.kind === 'model') {
            setEditing({ ...editing, design: val });
          } else {
            setNewModelDesign(val);
          }
        }}
        onClose={() => setDesignPickerFor(null)}
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
    gap: 12,
  },
  importBanner: {
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: RADII.md,
    padding: 14,
    gap: 10,
  },
  importText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e3a8a',
  },
  importBtn: {
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
  },
  importBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
  segBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: RADII.md,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  segTab: {
    flex: 1,
    minHeight: 40,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segTabActive: {
    backgroundColor: COLORS.surface,
  },
  segTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  segTabTextActive: {
    color: COLORS.text,
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
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  selectBtn: {
    minHeight: 46,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
  },
  selectText: {
    fontSize: 15,
    color: COLORS.text,
  },
  selectPlaceholder: {
    color: COLORS.textMuted,
  },
  addRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADII.sm,
    overflow: 'hidden',
    marginBottom: 8,
  },
  addInput: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  addBtn: {
    minHeight: 46,
    paddingHorizontal: 16,
    backgroundColor: COLORS.primarySoft,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    justifyContent: 'center',
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    paddingVertical: 14,
    textAlign: 'center',
  },
  listRow: {
    minHeight: 52,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  rowMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontVariant: ['tabular-nums'],
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionTouch: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  editLink: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  deleteLink: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.danger,
  },
  deleteLinkArmed: {
    fontWeight: '800',
  },
  editBlock: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  editInput: {
    minHeight: 46,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  cascadeHint: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
  },
  saveBtn: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryText,
  },
  cancelBtn: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  groupWrap: {
    marginTop: 12,
  },
  groupHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
});
