import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { Link } from 'expo-router'
import * as Sharing from 'expo-sharing'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native'
import { OrcaViewport, type ObjectInfo, type PresetInfo, type PresetKind, type SliceResult, type SliceStatistics, type ViewportMode } from 'react-native-orca-core'

import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { PresetPicker } from '@/components/PresetPicker'
import { PresetRow } from '@/components/PresetRow'
import { ProgressBar } from '@/components/ProgressBar'
import { SegmentedControl } from '@/components/SegmentedControl'
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
      <View className="flex-1 items-center justify-center gap-3 bg-gray-100 dark:bg-black">
        <ActivityIndicator color="#0a84ff" />
        <Text className="text-base text-gray-700 dark:text-gray-300">Loading profiles</Text>
      </View>
    )
  }

  const vendors = installedVendors()
  const canSlice = objects.length > 0 && vendors.length > 0
  const stepValid = (l: number) => (l < 0 && stats !== null ? stats.layerCount : l)
  const layerLabel = stats === null ? '' : maxLayer < 0 ? `All ${stats.layerCount} layers` : `Layer ${maxLayer} / ${stats.layerCount}`

  return (
    <>
      <ScrollView
        className="bg-gray-100 dark:bg-black"
        contentContainerClassName="p-4 gap-4 pb-16"
        contentInsetAdjustmentBehavior="automatic"
      >
        {vendors.length === 0 ? (
          <Card>
            <Text className="text-base font-semibold text-black dark:text-white">No printer profiles yet</Text>
            <Text className="text-base text-gray-600 dark:text-gray-300">
              Install at least one vendor bundle to start slicing.
            </Text>
            <Link href="/vendors" asChild>
              <Button title="Install profiles" fullWidth />
            </Link>
          </Card>
        ) : null}

        {presetError !== '' ? (
          <Card>
            <Text className="text-base text-red-500">{presetError}</Text>
            <Link href="/vendors" asChild>
              <Button title="Manage profiles" variant="secondary" fullWidth />
            </Link>
          </Card>
        ) : null}

        <View className="gap-2">
          <View className="h-80 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
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
            <View className="flex-row items-center gap-2 pt-1">
              <Button
                title="−"
                variant="secondary"
                onPress={() => setMaxLayer((l) => Math.max(0, stepValid(l) - 1))}
                disabled={stepValid(maxLayer) <= 0}
              />
              <Text className="flex-1 text-center text-base text-gray-600 dark:text-gray-300">{layerLabel}</Text>
              <Button
                title="+"
                variant="secondary"
                onPress={() => setMaxLayer((l) => (l < 0 || l + 1 >= stats.layerCount ? -1 : l + 1))}
                disabled={maxLayer < 0}
              />
            </View>
          ) : null}
        </View>

        <Card title="Presets">
          {PRESET_KINDS.map(({ kind, label }) => (
            <PresetRow
              key={kind}
              label={label}
              value={selected[kind]}
              disabled={busy}
              onPickPress={() => openPicker(kind)}
              editHref={{ pathname: '/settings/[kind]', params: { kind } }}
            />
          ))}
        </Card>

        <Card title="Objects">
          {objects.length === 0 ? (
            <Text className="text-base text-gray-500 dark:text-gray-400">Nothing on the plate yet.</Text>
          ) : (
            objects.map((o) => (
              <View
                key={o.id}
                className="flex-row items-center gap-2 border-b border-gray-200 py-1 dark:border-neutral-800"
              >
                <View className="flex-1">
                  <Text className="text-base text-black dark:text-white" numberOfLines={1}>
                    {o.name}
                  </Text>
                  <Text className="text-[13px] text-gray-500 dark:text-gray-400">
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
            ))
          )}
          <View className="flex-row gap-2 mt-1">
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

        <Card title="Slice">
          {progress !== null ? (
            <View className="gap-2">
              <Text className="text-base text-black dark:text-white">
                {progress.percent}% · {t(progress.message)}
              </Text>
              <ProgressBar percent={progress.percent} />
              <Button title="Cancel" variant="ghost" onPress={() => session.cancel()} />
            </View>
          ) : (
            <Button title="Slice plate" onPress={slice} disabled={!canSlice} fullWidth />
          )}
          {result !== null && result.outcome !== 'finished' ? (
            <Text className="text-base text-red-500">
              {result.outcome === 'cancelled' ? 'Cancelled' : result.error}
            </Text>
          ) : null}
          {result?.warnings.map((w, i) => (
            <Text key={i} className={`text-[13px] ${w.critical ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
              {w.text}
            </Text>
          ))}
          {stats !== null ? (
            <View className="gap-2 pt-1">
              <View className="flex-row gap-3">
                <Stat label="Print time" value={formatDuration(stats.printTimeSeconds)} />
                <Stat label="Filament" value={`${stats.filamentGrams.toFixed(1)} g`} />
                <Stat label="Layers" value={String(stats.layerCount)} />
              </View>
              <Button
                title="Share G-code"
                variant="secondary"
                onPress={share}
                disabled={gcodePath === null}
                fullWidth
              />
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button
                    title="Upload"
                    variant="secondary"
                    onPress={() => send(false)}
                    disabled={gcodePath === null || sending}
                    fullWidth
                  />
                </View>
                <View className="flex-1">
                  <Button
                    title="Upload & print"
                    onPress={() => send(true)}
                    disabled={gcodePath === null || sending}
                    fullWidth
                  />
                </View>
              </View>
            </View>
          ) : null}
        </Card>

        <Card title="Printers">
          <Text className="text-base text-gray-600 dark:text-gray-300">
            {printers.length === 0 ? 'None configured' : printers.map((p) => p.name).join(', ')}
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Link href="/printers" asChild>
                <Button title="Manage printers" variant="secondary" fullWidth />
              </Link>
            </View>
            <View className="flex-1">
              <Link href="/vendors" asChild>
                <Button title="Printer profiles" variant="secondary" fullWidth />
              </Link>
            </View>
          </View>
        </Card>

        <Text className="text-center text-[13px] text-gray-500 dark:text-gray-400">Core {version}</Text>
      </ScrollView>

      {pickerKind !== null ? (
        <PresetPicker
          kind={pickerKind}
          title={
            pickerKind === 'printer' ? 'Choose a printer' : pickerKind === 'filament' ? 'Choose a filament' : 'Choose a process'
          }
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

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-1">
      <Text className="text-[13px] text-gray-500 dark:text-gray-400">{label}</Text>
      <Text className="text-base font-semibold text-black dark:text-white">{value}</Text>
    </View>
  )
}
