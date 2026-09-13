import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { Link } from 'expo-router'
import * as Sharing from 'expo-sharing'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native'
import { OrcaViewport, type ObjectInfo, type PresetInfo, type PresetKind, type SliceResult, type SliceStatistics, type ViewportMode } from 'react-native-orca-core'

import { Alert as InlineAlert } from '@/ui/Alert'
import { Button } from '@/ui/Button'
import { Card, Row } from '@/ui/Card'
import { PresetPicker } from '@/ui/PresetPicker'
import { PresetRow } from '@/ui/PresetRow'
import { ProgressBar } from '@/ui/ProgressBar'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useCore } from '@/lib/core'
import { t } from '@/lib/i18n'
import { clientFor, loadPrinters, type PrinterHost } from '@/lib/printers'
import { installedVendors, nativePath } from '@/lib/profiles'

const PRESET_KINDS: Array<{ kind: PresetKind; label: string }> = [
  { kind: 'printer', label: 'Printer' },
  { kind: 'filament', label: 'Filament' },
  { kind: 'process', label: 'Process' },
]

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

export default function HomeScreen(): React.JSX.Element {
  const { version, session, presetError, ready } = useCore()
  const [objects, setObjects] = useState<ObjectInfo[]>([])
  const [selected, setSelected] = useState<Record<PresetKind, string>>({ printer: '', filament: '', process: '' })
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null)
  const [result, setResult] = useState<SliceResult | null>(null)
  const [stats, setStats] = useState<SliceStatistics | null>(null)
  const [gcodePath, setGcodePath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [printers, setPrinters] = useState<PrinterHost[]>([])
  const [viewMode, setViewMode] = useState<ViewportMode>('scene')
  const [maxLayer, setMaxLayer] = useState(-1)
  const [revision, setRevision] = useState(0)
  const [pickerKind, setPickerKind] = useState<PresetKind | null>(null)
  const [pickerPresets, setPickerPresets] = useState<PresetInfo[]>([])

  const refresh = useCallback(() => {
    if (session === null) return
    try {
      setRevision((r) => r + 1)
      setObjects(session.objects())
      setSelected({
        printer: session.selectedPreset('printer'),
        filament: session.selectedPreset('filament'),
        process: session.selectedPreset('process'),
      })
    } catch {
      /* mutex briefly held; caller will refresh again */
    }
  }, [session])

  useEffect(() => {
    if (ready) {
      refresh()
      setPrinters(loadPrinters())
    }
  }, [ready, refresh])

  const openPicker = useCallback(
    (kind: PresetKind) => {
      if (session === null) return
      try {
        setPickerPresets(session.presets(kind))
        setPickerKind(kind)
      } catch (e) {
        Alert.alert('Could not load presets', String(e))
      }
    },
    [session],
  )

  const pickPreset = useCallback(
    (name: string) => {
      if (session === null || pickerKind === null) return
      try {
        session.selectPreset(pickerKind, name)
      } catch (e) {
        Alert.alert('Could not select preset', String(e))
      }
      setPickerKind(null)
      refresh()
    },
    [session, pickerKind, refresh],
  )

  const importModel = useCallback(async () => {
    if (session === null) return
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
    const asset = picked.assets?.[0]
    if (picked.canceled || asset === undefined) return
    setBusy(true)
    try {
      await session.importModel(decodeURIComponent(asset.uri.replace(/^file:\/\//, '')))
      setResult(null)
      setStats(null)
      setGcodePath(null)
      refresh()
    } catch (error) {
      Alert.alert('Import failed', String(error))
    } finally {
      setBusy(false)
    }
  }, [session, refresh])

  const slice = useCallback(async () => {
    if (session === null) return
    setBusy(true)
    setResult(null)
    setStats(null)
    setGcodePath(null)
    setProgress({ percent: 0, message: 'Starting' })
    try {
      const sliced = await session.slice((p) => setProgress(p))
      setResult(sliced)
      if (sliced.outcome === 'finished') {
        const out = new File(Paths.cache, 'plate_1.gcode')
        const written = await session.exportGCode(nativePath(out.parentDirectory) + '/plate_1.gcode')
        setGcodePath(written)
        setStats(session.statistics())
        setMaxLayer(-1)
        setViewMode('preview')
        setRevision((r) => r + 1)
      }
    } catch (error) {
      Alert.alert('Slicing failed', String(error))
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }, [session])

  const share = useCallback(async () => {
    if (gcodePath === null) return
    await Sharing.shareAsync('file://' + gcodePath, { mimeType: 'text/x-gcode', dialogTitle: 'Send G-code' })
  }, [gcodePath])

  const sendTo = useCallback(
    async (host: PrinterHost, startPrint: boolean) => {
      if (gcodePath === null) return
      setSending(true)
      try {
        const filename = `${objects[0]?.name.replace(/\.[^.]+$/, '') ?? 'plate'}_${Date.now().toString(36)}.gcode`
        await clientFor(host).upload(host, { path: gcodePath, filename, startPrint })
        Alert.alert(startPrint ? 'Print started' : 'Uploaded', `${filename} on ${host.name}`)
      } catch (error) {
        Alert.alert(`Could not send to ${host.name}`, String(error))
      } finally {
        setSending(false)
      }
    },
    [gcodePath, objects],
  )

  const send = useCallback(
    (startPrint: boolean) => {
      const current = loadPrinters()
      setPrinters(current)
      if (current.length === 0) {
        Alert.alert('No printers', 'Add a printer first.')
        return
      }
      if (current.length === 1 && current[0] !== undefined) {
        void sendTo(current[0], startPrint)
        return
      }
      Alert.alert('Send to', undefined, [
        ...current.map((host) => ({ text: host.name, onPress: () => void sendTo(host, startPrint) })),
        { text: 'Cancel', style: 'cancel' as const },
      ])
    },
    [sendTo],
  )

  if (!ready || session === null) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-gray-50 dark:bg-black">
        <ActivityIndicator color="#0a84ff" />
        <Text className="text-[15px] text-gray-500 dark:text-gray-400">Loading profiles…</Text>
      </View>
    )
  }

  const vendors = installedVendors()
  // A preset is "chosen" only if it points at a real system/user profile;
  // the built-in "Default Printer" / "Default Filament" / "Default Setting"
  // fallbacks are placeholders that fail validation the moment you slice.
  const isDefaultPreset = (name: string) => name === '' || name.startsWith('Default ')
  const hasRealPrinter = !isDefaultPreset(selected.printer)
  const canSlice = objects.length > 0 && hasRealPrinter
  const stepValid = (l: number) => (l < 0 && stats !== null ? stats.layerCount : l)
  const layerLabel = stats === null ? '' : maxLayer < 0 ? `All ${stats.layerCount} layers` : `Layer ${maxLayer} of ${stats.layerCount}`

  return (
    <>
      <ScrollView
        className="bg-neutral-50 dark:bg-neutral-950"
        contentContainerClassName="px-4 pt-2 pb-24"
        contentInsetAdjustmentBehavior="automatic"
      >
        {!hasRealPrinter ? (
          <View className="mb-4">
            <Card padded>
              <View className="items-start gap-3">
                <Text className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent-600">
                  Get set up
                </Text>
                <Text className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                  Pick your printer to start slicing
                </Text>
                <Text className="text-[15px] leading-5 text-neutral-500 dark:text-neutral-400">
                  Browse every printer OrcaSlicer knows about. The right filament and process presets install with it.
                </Text>
                <Link href="/vendors" asChild>
                  <Button title="Choose a printer" size="lg" fullWidth />
                </Link>
              </View>
            </Card>
          </View>
        ) : null}

        {presetError !== '' ? (
          <View className="mb-4">
            <InlineAlert
              tone="critical"
              title="Profile load failed"
              action={
                <Link href="/vendors" asChild>
                  <Button title="Reinstall profiles" variant="secondary" fullWidth />
                </Link>
              }
            >
              {presetError}
            </InlineAlert>
          </View>
        ) : null}

        <View className="mb-6 gap-3">
          <View className="h-[360px] overflow-hidden rounded-3xl bg-white shadow-soft dark:bg-neutral-900">
            <OrcaViewport
              style={{ flex: 1 }}
              sessionId={session.id}
              mode={viewMode}
              maxLayer={maxLayer}
              showTravels={false}
              revision={revision}
            />
          </View>
          <SegmentedControl
            value={viewMode}
            options={[
              { value: 'scene', label: 'Objects' },
              { value: 'preview', label: 'Preview', disabled: stats === null },
            ]}
            onChange={setViewMode}
          />
          {viewMode === 'preview' && stats !== null ? (
            <View className="flex-row items-center gap-3 pt-1">
              <Button
                title="−"
                variant="secondary"
                onPress={() => setMaxLayer((l) => Math.max(0, stepValid(l) - 1))}
                disabled={stepValid(maxLayer) <= 0}
              />
              <Text className="flex-1 text-center text-[15px] text-neutral-700 dark:text-neutral-300">
                {layerLabel}
              </Text>
              <Button
                title="+"
                variant="secondary"
                onPress={() => setMaxLayer((l) => (l < 0 || l + 1 >= stats.layerCount ? -1 : l + 1))}
                disabled={maxLayer < 0}
              />
            </View>
          ) : null}
        </View>

        <Card className="mb-6" title="Presets" padded={false} index={0}>
          {PRESET_KINDS.map(({ kind, label }, i) => (
            <PresetRow
              key={kind}
              label={label}
              value={selected[kind]}
              disabled={busy}
              onPickPress={() => openPicker(kind)}
              editHref={{ pathname: '/settings/[kind]', params: { kind } }}
              last={i === PRESET_KINDS.length - 1}
            />
          ))}
        </Card>

        <Card
          className="mb-6"
          index={1}
          title="Plate"
          subtitle={objects.length === 0 ? 'Nothing on the plate yet' : `${objects.length} object${objects.length === 1 ? '' : 's'}`}
          padded={false}
        >
          {objects.length === 0 ? (
            <Row last>
              <Text className="text-[15px] text-gray-500 dark:text-gray-400">
                Import an STL, OBJ, 3MF or STEP file to get started.
              </Text>
            </Row>
          ) : (
            objects.map((o, i) => (
              <Row key={o.id} last={i === objects.length - 1}>
                <View className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text className="text-[15px] text-black dark:text-white" numberOfLines={1}>
                      {o.name}
                    </Text>
                    <Text className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">
                      {o.size.x.toFixed(1)} × {o.size.y.toFixed(1)} × {o.size.z.toFixed(1)} mm
                    </Text>
                  </View>
                  <Button
                    title="Remove"
                    variant="ghost"
                    onPress={() => {
                      session.removeObject(o.id)
                      refresh()
                    }}
                    disabled={busy}
                  />
                </View>
              </Row>
            ))
          )}
          <View className="flex-row gap-3 border-t border-gray-100 p-4 dark:border-neutral-800">
            <View className="flex-1">
              <Button title="Import model" variant="secondary" onPress={importModel} disabled={busy} fullWidth />
            </View>
            <View className="flex-1">
              <Button
                title="Arrange"
                variant="secondary"
                disabled={busy || objects.length === 0}
                fullWidth
                onPress={() => {
                  setBusy(true)
                  session
                    .arrange()
                    .then(refresh)
                    .catch((error: unknown) => Alert.alert('Arrange failed', String(error)))
                    .finally(() => setBusy(false))
                }}
              />
            </View>
          </View>
        </Card>

        <Card className="mb-6" title="Slice" index={2}>
          {progress !== null ? (
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-[15px] font-medium text-black dark:text-white" numberOfLines={1}>
                  {t(progress.message)}
                </Text>
                <Text className="text-[15px] font-semibold text-blue-500">{progress.percent}%</Text>
              </View>
              <ProgressBar percent={progress.percent} />
              <Button title="Cancel" variant="ghost" onPress={() => session.cancel()} fullWidth />
            </View>
          ) : (
            <Button
              title={stats !== null ? 'Slice again' : 'Slice plate'}
              size="lg"
              onPress={slice}
              disabled={!canSlice}
              fullWidth
            />
          )}

          {result !== null && result.outcome !== 'finished' ? (
            <InlineAlert tone="critical" title={result.outcome === 'cancelled' ? 'Cancelled' : 'Slicing failed'}>
              {result.outcome === 'cancelled' ? 'You cancelled the slice.' : result.error}
            </InlineAlert>
          ) : null}

          {result !== null && result.warnings.length > 0 ? (
            <InlineAlert
              tone={result.warnings.some((w) => w.critical) ? 'critical' : 'warning'}
              title={result.warnings.length === 1 ? '1 slicing warning' : `${result.warnings.length} slicing warnings`}
            >
              <View className="gap-1">
                {result.warnings.map((w, i) => (
                  <Text
                    key={i}
                    className={`text-[13px] leading-5 ${w.critical ? 'text-red-900/80 dark:text-red-100/80' : 'text-amber-900/80 dark:text-amber-100/80'}`}
                  >
                    • {w.text}
                  </Text>
                ))}
              </View>
            </InlineAlert>
          ) : null}

          {stats !== null ? (
            <View className="gap-3">
              <View className="flex-row gap-3">
                <StatTile label="Print time" value={formatDuration(stats.printTimeSeconds)} />
                <StatTile label="Filament" value={`${stats.filamentGrams.toFixed(1)} g`} />
                <StatTile label="Layers" value={String(stats.layerCount)} />
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Button title="Share G-code" variant="secondary" onPress={share} disabled={gcodePath === null} fullWidth />
                </View>
                <View className="flex-1">
                  <Button
                    title="Send to printer"
                    onPress={() => send(true)}
                    disabled={gcodePath === null || sending}
                    fullWidth
                  />
                </View>
              </View>
            </View>
          ) : null}
        </Card>

        <Card
          className="mb-6"
          index={3}
          title="Destinations"
          subtitle={printers.length === 0 ? 'None configured' : printers.map((p) => p.name).join(' · ')}
          padded={false}
        >
          <Row>
            <Link href="/printers" asChild>
              <Button title="Manage destinations" variant="ghost" fullWidth />
            </Link>
          </Row>
          <Row last>
            <Link href="/vendors" asChild>
              <Button title="Change printer" variant="ghost" fullWidth />
            </Link>
          </Row>
        </Card>

        <Text className="text-center text-[11px] uppercase tracking-widest text-neutral-400 dark:text-neutral-600">
          OrcaCore {version}
        </Text>
      </ScrollView>

      {pickerKind !== null ? (
        <PresetPicker
          kind={pickerKind}
          title={pickerKind === 'printer' ? 'Choose a printer' : pickerKind === 'filament' ? 'Choose a filament' : 'Choose a process'}
          presets={pickerPresets}
          selected={selected[pickerKind]}
          visible
          onPick={pickPreset}
          onClose={() => setPickerKind(null)}
        />
      ) : null}
    </>
  )
}

function StatTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-1 rounded-xl bg-gray-100 px-3 py-3 dark:bg-neutral-800">
      <Text className="text-[12px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</Text>
      <Text className="mt-1 text-[17px] font-semibold text-black dark:text-white" numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}
