import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { cache: '' } }))
vi.mock('expo-file-system/legacy', () => ({
  copyAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
}))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('./presetFiles', () => ({
  PRESET_FILE_PATTERN: /\.(orca_printer|orca_filament|orca_bundle|zip|json)$/i,
}))

const { classifyName, extensionFromBytes, knownExtension, lastSegment } = await import('./openFile')

const bytes = (text: string): Uint8Array => new Uint8Array([...text].map((c) => c.charCodeAt(0)))

describe('classifyName', () => {
  it('sends models to the plate and preset files to the importer', () => {
    expect(classifyName('Benchy.STL')).toBe('model')
    expect(classifyName('/tmp/project.3mf')).toBe('model')
    expect(classifyName('part.step')).toBe('model')
    expect(classifyName('My Printer.orca_printer')).toBe('presets')
    expect(classifyName('presets.zip')).toBe('presets')
    expect(classifyName('process.json')).toBe('presets')
    expect(classifyName('notes.txt')).toBeNull()
    expect(classifyName('model')).toBeNull()
  })
})

describe('knownExtension', () => {
  it('returns the lower-case extension only for names the app opens', () => {
    expect(knownExtension('Benchy.STL')).toBe('stl')
    expect(knownExtension('bundle.orca_bundle')).toBe('orca_bundle')
    expect(knownExtension('image.png')).toBeNull()
    expect(knownExtension('msf:1234')).toBeNull()
  })
})

describe('lastSegment', () => {
  it('reads the file name providers put at the end of a document id', () => {
    expect(
      lastSegment(
        'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fmodel.3mf',
      ),
    ).toBe('model.3mf')
    expect(
      lastSegment('content://com.android.providers.downloads.documents/document/msf%3A1234'),
    ).toBe('1234')
    expect(lastSegment('content://x/document/a%ZZ')).toBe('a%ZZ')
  })
})

describe('extensionFromBytes', () => {
  const none = new Uint8Array(0)

  it('tells a 3MF from a preset zip by the central directory', () => {
    const zipHead = bytes('PK\u0003\u0004rest')
    expect(extensionFromBytes(zipHead, bytes('...3D/3dmodel.modelPK\u0005\u0006'), 4096)).toBe(
      '3mf',
    )
    expect(extensionFromBytes(zipHead, bytes('...Printer.jsonPK\u0005\u0006'), 4096)).toBe('zip')
    expect(extensionFromBytes(zipHead, bytes('...readme.txtPK\u0005\u0006'), 4096)).toBeNull()
  })

  it('recognises text formats by their opening', () => {
    expect(extensionFromBytes(bytes('ISO-10303-21;\nHEADER;'), none, 100)).toBe('step')
    expect(extensionFromBytes(bytes('solid cube\n facet normal'), none, 100)).toBe('stl')
    expect(extensionFromBytes(bytes('<?xml version="1.0"?>\n<amf unit="mm">'), none, 100)).toBe(
      'amf',
    )
    expect(extensionFromBytes(bytes('  {"type": "process"}'), none, 100)).toBe('json')
    expect(extensionFromBytes(bytes('# Blender\nv 1 2 3\nv 4 5 6\n'), none, 100)).toBe('obj')
  })

  it('recognises a binary STL by its size', () => {
    const header = new Uint8Array(84)
    expect(extensionFromBytes(header, none, 84 + 50 * 12)).toBe('stl')
    expect(extensionFromBytes(header, none, 84 + 50 * 12 + 1)).toBeNull()
  })
})
