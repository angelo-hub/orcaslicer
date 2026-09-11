import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { Link } from 'expo-router'
import * as Sharing from 'expo-sharing'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ObjectInfo, PresetKind, SliceResult, SliceStatistics } from 'react-native-orca-core'

import { useCore } from '@/lib/core'
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

  const refresh = useCallback(() => {
    if (session === null || session.isBusy) return
    setObjects(session.objects())
    setSelected({
      printer: session.selectedPreset('printer'),
      filament: session.selectedPreset('filament'),
      process: session.selectedPreset('process'),
    })
  }, [session])

  useEffect(() => {
    if (ready) refresh()
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

      <View style={styles.card}>
        <Text style={styles.title}>Presets</Text>
        {PRESET_KINDS.map(({ kind, label }) => (
          <Link key={kind} href={{ pathname: '/presets/[kind]', params: { kind } }} asChild>
            <Button title={`${label}: ${selected[kind] || 'none'}`} disabled={busy} />
          </Link>
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
              {progress.percent}% {progress.message}
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
            <Button title="Send G-code" onPress={share} disabled={gcodePath === null} />
          </View>
        ) : null}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  card: { gap: 8, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  title: { fontWeight: '600', fontSize: 16 },
  muted: { color: '#666' },
  error: { color: '#b00020' },
})
