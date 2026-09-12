import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { Link } from 'expo-router'
import * as Sharing from 'expo-sharing'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { OrcaViewport, type ObjectInfo, type PresetKind, type SliceResult, type SliceStatistics, type ViewportMode } from 'react-native-orca-core'

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

  const refresh = useCallback(() => {
    if (session === null || session.isBusy) return
    setRevision((r) => r + 1)
    setObjects(session.objects())
    setSelected({
      printer: session.selectedPreset('printer'),
      filament: session.selectedPreset('filament'),
      process: session.selectedPreset('process'),
    })
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
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading profiles</Text>
      </View>
    )
  }

  const vendors = installedVendors()

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.muted}>Core {version}</Text>

      {vendors.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>No printer profiles yet</Text>
          <Text>Install at least one vendor's profiles to pick a printer.</Text>
          <Link href="/vendors" asChild>
            <Button title="Install profiles" />
          </Link>
        </View>
      ) : null}
      {presetError !== '' ? <Text style={styles.error}>{presetError}</Text> : null}

      <View style={styles.viewportCard}>
        <OrcaViewport
          style={styles.viewport}
          sessionId={session.id}
          mode={viewMode}
          maxLayer={maxLayer}
          showTravels={false}
          revision={revision}
        />
        <View style={styles.row}>
          <Button title="Objects" onPress={() => setViewMode('scene')} disabled={viewMode === 'scene'} />
          <Button title="Preview" onPress={() => setViewMode('preview')} disabled={viewMode === 'preview' || stats === null} />
          {viewMode === 'preview' && stats !== null ? (
            <View style={styles.row}>
              <Button title="−" onPress={() => setMaxLayer((l) => Math.max(0, (l < 0 ? stats.layerCount : l) - 1))} />
              <Text style={styles.muted}>{maxLayer < 0 ? `all ${stats.layerCount}` : `layer ${maxLayer}`}</Text>
              <Button title="+" onPress={() => setMaxLayer((l) => (l < 0 || l + 1 >= stats.layerCount ? -1 : l + 1))} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Presets</Text>
        {PRESET_KINDS.map(({ kind, label }) => (
          <View key={kind} style={styles.row}>
            <View style={styles.grow}>
              <Link href={{ pathname: '/presets/[kind]', params: { kind } }} asChild>
                <Button title={`${label}: ${selected[kind] || 'none'}`} disabled={busy} />
              </Link>
            </View>
            <Link href={{ pathname: '/settings/[kind]', params: { kind } }} asChild>
              <Button title="Edit" disabled={busy} />
            </Link>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Objects</Text>
        {objects.length === 0 ? <Text style={styles.muted}>Nothing on the plate</Text> : null}
        {objects.map((o) => (
          <View key={o.id} style={styles.row}>
            <Text style={styles.grow}>{o.name}</Text>
            <Text style={styles.muted}>
              {o.size.x.toFixed(1)} × {o.size.y.toFixed(1)} × {o.size.z.toFixed(1)} mm
            </Text>
            <Button
              title="Remove"
              disabled={busy}
              onPress={() => {
                session.removeObject(o.id)
                refresh()
              }}
            />
          </View>
        ))}
        <Button title="Import model" onPress={importModel} disabled={busy} />
        <Button
          title="Arrange"
          disabled={busy || objects.length === 0}
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

      <View style={styles.card}>
        <Text style={styles.title}>Slice</Text>
        {progress !== null ? (
          <View style={styles.row}>
            <ActivityIndicator />
            <Text style={styles.grow}>
              {progress.percent}% {t(progress.message)}
            </Text>
            <Button title="Cancel" onPress={() => session.cancel()} />
          </View>
        ) : (
          <Button title="Slice plate" onPress={slice} disabled={busy || objects.length === 0} />
        )}
        {result !== null && result.outcome !== 'finished' ? (
          <Text style={styles.error}>{result.outcome === 'cancelled' ? 'Cancelled' : result.error}</Text>
        ) : null}
        {result?.warnings.map((w, i) => (
          <Text key={i} style={w.critical ? styles.error : styles.muted}>
            {w.text}
          </Text>
        ))}
        {stats !== null ? (
          <View>
            <Text>Print time {formatDuration(stats.printTimeSeconds)}</Text>
            <Text>
              Filament {stats.filamentGrams.toFixed(1)} g, {stats.layerCount} layers
            </Text>
            <Button title="Share G-code" onPress={share} disabled={gcodePath === null} />
            <Button title="Upload to printer" onPress={() => send(false)} disabled={gcodePath === null || sending} />
            <Button title="Upload and print" onPress={() => send(true)} disabled={gcodePath === null || sending} />
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Printers</Text>
        <Text style={styles.muted}>{printers.length === 0 ? 'None configured' : printers.map((p) => p.name).join(', ')}</Text>
        <Link href="/printers" asChild>
          <Button title="Manage printers" />
        </Link>
        <Link href="/vendors" asChild>
          <Button title="Printer profiles" />
        </Link>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  card: { gap: 8, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  viewportCard: { gap: 8 },
  viewport: { height: 320, borderRadius: 8, overflow: 'hidden', backgroundColor: '#eceff1' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  title: { fontWeight: '600', fontSize: 16 },
  muted: { color: '#666' },
  error: { color: '#b00020' },
})
