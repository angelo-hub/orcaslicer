import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { Link } from 'expo-router'
import * as Sharing from 'expo-sharing'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { OrcaViewport, type ObjectInfo, type PresetKind, type SliceResult, type SliceStatistics, type ViewportMode } from 'react-native-orca-core'

import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { PresetRow } from '@/components/PresetRow'
import { ProgressBar } from '@/components/ProgressBar'
import { SegmentedControl } from '@/components/SegmentedControl'
import { useCore } from '@/lib/core'
import { t } from '@/lib/i18n'
import { clientFor, loadPrinters, type PrinterHost } from '@/lib/printers'
import { installedVendors, nativePath } from '@/lib/profiles'
import { radius, spacing, typography, useTheme } from '@/lib/theme'

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
  const { colors } = useTheme()
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

  const refresh = useCallback(() => {
    if (session === null) return
    // Do not gate on session.isBusy: on Nitro, the mutex can appear locked
    // for a microtask after the awaited promise resolves, and skipping here
    // would leave the UI stale until the next unrelated re-render.
    try {
      setRevision((r) => r + 1)
      setObjects(session.objects())
      setSelected({
        printer: session.selectedPreset('printer'),
        filament: session.selectedPreset('filament'),
        process: session.selectedPreset('process'),
      })
    } catch {
      /* mutex was actually held; caller will refresh again when work completes */
    }
  }, [session])

  useEffect(() => {
    if (ready) {
      refresh()
      setPrinters(loadPrinters())
    }
  }, [ready, refresh])

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
    [gcodePath, objects]
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
    [sendTo]
  )

  if (!ready || session === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
        <Text style={{ ...typography.body, color: colors.textMuted }}>Loading profiles</Text>
      </View>
    )
  }

  const vendors = installedVendors()
  const canSlice = objects.length > 0 && vendors.length > 0
  const stepValid = (l: number) => (l < 0 && stats !== null ? stats.layerCount : l)
  const layerLabel = stats === null ? '' : maxLayer < 0 ? `All ${stats.layerCount} layers` : `Layer ${maxLayer} / ${stats.layerCount}`

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 }}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
    >
      {vendors.length === 0 ? (
        <Card>
          <Text style={{ ...typography.bodyStrong, color: colors.text }}>No printer profiles yet</Text>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            Install at least one vendor bundle to start slicing.
          </Text>
          <Link href="/vendors" asChild>
            <Button title="Install profiles" fullWidth />
          </Link>
        </Card>
      ) : null}

      {presetError !== '' ? (
        <Card>
          <Text style={{ ...typography.body, color: colors.danger }}>{presetError}</Text>
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <View
          style={{
            height: 320,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.separator,
          }}
        >
          <OrcaViewport
            style={StyleSheet.absoluteFillObject}
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingTop: spacing.xs,
            }}
          >
            <Button
              title="−"
              variant="secondary"
              onPress={() => setMaxLayer((l) => Math.max(0, stepValid(l) - 1))}
              disabled={stepValid(maxLayer) <= 0}
            />
            <Text style={{ ...typography.body, color: colors.textMuted, flex: 1, textAlign: 'center' }}>
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

      <Card title="Presets">
        {PRESET_KINDS.map(({ kind, label }) => (
          <PresetRow
            key={kind}
            label={label}
            value={selected[kind]}
            disabled={busy}
            pickHref={{ pathname: '/presets/[kind]', params: { kind } }}
            editHref={{ pathname: '/settings/[kind]', params: { kind } }}
          />
        ))}
      </Card>

      <Card title="Objects">
        {objects.length === 0 ? (
          <Text style={{ ...typography.body, color: colors.textSubdued }}>Nothing on the plate yet.</Text>
        ) : (
          objects.map((o) => (
            <View
              key={o.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.xs,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.separator,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.body, color: colors.text }} numberOfLines={1}>
                  {o.name}
                </Text>
                <Text style={{ ...typography.caption, color: colors.textSubdued }}>
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
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
          <View style={{ flex: 1 }}>
            <Button title="Import model" variant="secondary" onPress={importModel} disabled={busy} fullWidth />
          </View>
          <View style={{ flex: 1 }}>
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
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...typography.body, color: colors.text }}>
              {progress.percent}% · {t(progress.message)}
            </Text>
            <ProgressBar percent={progress.percent} />
            <Button title="Cancel" variant="ghost" onPress={() => session.cancel()} />
          </View>
        ) : (
          <Button title="Slice plate" onPress={slice} disabled={!canSlice} fullWidth />
        )}
        {result !== null && result.outcome !== 'finished' ? (
          <Text style={{ ...typography.body, color: colors.danger }}>
            {result.outcome === 'cancelled' ? 'Cancelled' : result.error}
          </Text>
        ) : null}
        {result?.warnings.map((w, i) => (
          <Text
            key={i}
            style={{ ...typography.caption, color: w.critical ? colors.danger : colors.textSubdued }}
          >
            {w.text}
          </Text>
        ))}
        {stats !== null ? (
          <View style={{ gap: spacing.sm, paddingTop: spacing.xs }}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
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
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Upload"
                  variant="secondary"
                  onPress={() => send(false)}
                  disabled={gcodePath === null || sending}
                  fullWidth
                />
              </View>
              <View style={{ flex: 1 }}>
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
        <Text style={{ ...typography.body, color: colors.textMuted }}>
          {printers.length === 0 ? 'None configured' : printers.map((p) => p.name).join(', ')}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Link href="/printers" asChild>
              <Button title="Manage printers" variant="secondary" fullWidth />
            </Link>
          </View>
          <View style={{ flex: 1 }}>
            <Link href="/vendors" asChild>
              <Button title="Printer profiles" variant="secondary" fullWidth />
            </Link>
          </View>
        </View>
      </Card>

      <Text style={{ ...typography.caption, color: colors.textSubdued, textAlign: 'center' }}>Core {version}</Text>
    </ScrollView>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ ...typography.caption, color: colors.textSubdued }}>{label}</Text>
      <Text style={{ ...typography.bodyStrong, color: colors.text }}>{value}</Text>
    </View>
  )
}
