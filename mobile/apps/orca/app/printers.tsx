import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Button, FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'

import { clientFor, HOST_KINDS, loadPrinters, normalizeUrl, savePrinters, type PrinterHost, type PrinterHostKind, type PrinterStatus } from '@/lib/printers'

// Printers the app can send G-code to. Stored in the core's data directory.

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface EditorProps {
  initial: PrinterHost | null
  onDone: (host: PrinterHost | null) => void
}

function PrinterEditor({ initial, onDone }: EditorProps): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<PrinterHostKind>(initial?.kind ?? 'moonraker')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  const host = (): PrinterHost => ({
    id: initial?.id ?? newId(),
    name: name.trim() === '' ? normalizeUrl(url) : name.trim(),
    kind,
    url: normalizeUrl(url),
    apiKey: apiKey.trim() === '' ? undefined : apiKey.trim(),
  })

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult('')
    try {
      setTestResult(await clientFor(host()).info(host()))
    } catch (error) {
      setTestResult(String(error))
    } finally {
      setTesting(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={styles.title}>{initial === null ? 'Add printer' : 'Edit printer'}</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Voron" autoCorrect={false} />
      <Text style={styles.label}>Host</Text>
      <View style={styles.row}>
        {HOST_KINDS.map((k) => (
          <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={[styles.chip, kind === k.kind && styles.chipActive]}>
            <Text style={kind === k.kind ? styles.chipTextActive : styles.chipText}>{k.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Address</Text>
      <TextInput style={styles.input} value={url} onChangeText={setUrl} placeholder={HOST_KINDS.find((k) => k.kind === kind)?.hint} autoCorrect={false} autoCapitalize="none" keyboardType="url" />
      <Text style={styles.label}>{kind === 'octoprint' ? 'Application key' : 'API key (optional)'}</Text>
      <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey} autoCorrect={false} autoCapitalize="none" secureTextEntry />
      <View style={styles.row}>
        <Button title={testing ? 'Testing…' : 'Test connection'} onPress={test} disabled={testing || url.trim() === ''} />
        <Button title="Save" onPress={() => onDone(host())} disabled={url.trim() === '' || (kind === 'octoprint' && apiKey.trim() === '')} />
        <Button title="Cancel" onPress={() => onDone(null)} />
      </View>
      {testResult !== '' ? <Text style={styles.muted}>{testResult}</Text> : null}
    </ScrollView>
  )
}

function describe(status: PrinterStatus): string {
  const parts = [status.state]
  if (status.progress !== undefined) parts.push(`${Math.round(status.progress * 100)}%`)
  if (status.file !== undefined && status.file !== '') parts.push(status.file)
  if (status.nozzleTemperature !== undefined) parts.push(`nozzle ${Math.round(status.nozzleTemperature)}/${Math.round(status.nozzleTarget ?? 0)}°`)
  if (status.bedTemperature !== undefined) parts.push(`bed ${Math.round(status.bedTemperature)}/${Math.round(status.bedTarget ?? 0)}°`)
  return parts.join(' · ')
}

export default function PrintersScreen(): React.JSX.Element {
  const [printers, setPrinters] = useState<PrinterHost[]>([])
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<{ host: PrinterHost | null } | null>(null)
  const [polling, setPolling] = useState(true)

  useEffect(() => {
    setPrinters(loadPrinters())
  }, [])

  const refresh = useCallback(async () => {
    const next: Record<string, string> = {}
    await Promise.all(
      printers.map(async (host) => {
        try {
          next[host.id] = describe(await clientFor(host).status(host))
        } catch (error) {
          next[host.id] = `offline (${String(error)})`
        }
      })
    )
    setStatuses(next)
  }, [printers])

  useEffect(() => {
    if (!polling) return
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [polling, refresh])

  const persist = (next: PrinterHost[]): void => {
    setPrinters(next)
    savePrinters(next)
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={printers}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Text style={styles.muted}>No printers yet. Add a Klipper (Moonraker) or OctoPrint host.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => setEditing({ host: item })}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.muted}>{item.url}</Text>
            <Text style={styles.muted}>{statuses[item.id] ?? 'checking…'}</Text>
            <Button
              title="Remove"
              color="#b00020"
              onPress={() =>
                Alert.alert('Remove printer', item.name, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => persist(printers.filter((p) => p.id !== item.id)) },
                ])
              }
            />
          </Pressable>
        )}
      />
      <View style={styles.footer}>
        <View style={styles.row}>
          <Text>Poll status</Text>
          <Switch value={polling} onValueChange={setPolling} />
        </View>
        <Button title="Add printer" onPress={() => setEditing({ host: null })} />
      </View>
      <Modal visible={editing !== null} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing !== null ? (
          <PrinterEditor
            initial={editing.host}
            onDone={(host) => {
              if (host !== null) {
                const others = printers.filter((p) => p.id !== host.id)
                persist([...others, host])
              }
              setEditing(null)
            }}
          />
        ) : null}
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 16, paddingTop: 48, gap: 8 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  label: { color: '#666', marginTop: 8 },
  input: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#eee' },
  chipActive: { backgroundColor: '#0d7f62' },
  chipText: { color: '#333' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  item: { padding: 16, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  name: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#666', padding: 4 },
  footer: { padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
})
