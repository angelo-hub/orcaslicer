import { describe, expect, test } from 'vitest'

import { PAGE_BRIDGE, dispatchScript, pageMessageData } from './pageBridge.ts'

describe('page bridge', () => {
  test('installs window.orca and the wx shim the desktop page expects', () => {
    expect(PAGE_BRIDGE).toContain('window.orca = {')
    expect(PAGE_BRIDGE).toContain('window.__orcaDispatch = function')
    expect(PAGE_BRIDGE).toContain('window.ReactNativeWebView.postMessage')
  })

  test('unwraps the bridge envelope and ignores other messages', () => {
    expect(pageMessageData('{"channel":"orca","kind":"message","data":{"cmd":"refresh"}}')).toBe(
      '{"cmd":"refresh"}',
    )
    expect(pageMessageData('{"channel":"orca","kind":"message"}')).toBe('null')
    expect(pageMessageData('{"command":"get_login_cmd"}')).toBeUndefined()
    expect(pageMessageData('not json')).toBeUndefined()
  })

  test('wraps a plugin message for window.__orcaDispatch, JSON or plain text', () => {
    expect(dispatchScript('{"spools":[1,2]}')).toContain('{"data":{"spools":[1,2]}}')
    expect(dispatchScript('hello')).toContain('{"data":"hello"}')
    expect(dispatchScript('{}')).toMatch(/__orcaDispatch/)
  })
})
