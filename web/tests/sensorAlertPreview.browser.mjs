// Browser verification of the generated OFFLINE file only. Never opens the real app.
// node tests/sensorAlertPreview.browser.mjs <preview.html> <new-audit-folder>
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [html, output] = process.argv.slice(2)
assert.ok(html && output, 'Supply the offline HTML path and audit folder')
const profile = await mkdtemp(join(resolve(output), 'isolated-chrome-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
let socket
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = ''
    const timeout = setTimeout(() => reject(Error('Isolated Chrome startup timeout')), 15000)
    chrome.on('error', reject)
    chrome.stderr.on('data', value => {
      stderr += value
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  socket = new WebSocket(endpoint)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let sequence = 0
  const pending = new Map(), requests = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url)
    if (message.id) {
      const callback = pending.get(message.id); pending.delete(message.id)
      if (message.error) callback.reject(Error(message.error.message)); else callback.resolve(message.result)
    }
  })
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Page.enable', {}, sessionId); await call('Network.enable', {}, sessionId)
  for (const width of [1440, 390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId)
    await call('Page.navigate', { url: pathToFileURL(resolve(html)).href }, sessionId)
    await evaluate(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(document.querySelectorAll('.same-event-readings tbody tr').length===6){clearInterval(timer);resolve(true)}},30);setTimeout(()=>{clearInterval(timer);reject(Error('Sensor preview did not render'))},10000)})`)
    const state = await evaluate(`(()=>{const modal=document.querySelector('[role="dialog"]'),chip=modal.querySelector('.assigned-plant-chip');chip.focus();const rect=modal.getBoundingClientRect();return {fits:rect.left>=0&&rect.right<=innerWidth,viewport:innerWidth,columns:getComputedStyle(modal.querySelector('.investigation-grid')).gridTemplateColumns,controls:[...modal.querySelectorAll('.officer-review select,.officer-review textarea,.officer-review .primary-button')].every(x=>x.disabled),banner:modal.querySelector('.sensor-demo-banner').textContent,trigger:modal.querySelectorAll('.evidence-role.trigger').length,context:modal.querySelectorAll('.evidence-role.context').length,focus:document.activeElement===chip,outline:getComputedStyle(chip).outlineWidth,href:chip.getAttribute('href'),requests:window.__previewRequests}})()`)
    assert.equal(state.viewport, width); assert.equal(state.fits, true)
    assert.equal(state.controls, true); assert.equal(state.banner, 'DEMO PREVIEW — NOT REAL ALERT DATA')
    assert.equal(state.trigger, 1); assert.equal(state.context, 5)
    assert.equal(state.focus, true); assert.equal(state.outline, '3px'); assert.equal(state.href, '#')
    if (width === 390) assert.equal(state.columns.trim().split(' ').length, 1)
    assert.ok(state.requests.every(r => r.method === 'GET' && r.url.startsWith('/api/data/alerts')))
    // Even an accidental mutation attempt hits the local rejection, never a network request.
    assert.equal(await evaluate(`fetch('/api/data/alerts/fixture-temperature-alert/responses',{method:'POST'}).then(()=>false,()=>true)`), true)
    await evaluate(`document.querySelector('.same-event-readings').scrollIntoView({block:'center'})`)
    const bannerVisible = await evaluate(`(()=>{const b=document.querySelector('.sensor-demo-banner').getBoundingClientRect(),m=document.querySelector('[role="dialog"]').getBoundingClientRect();return b.top>=m.top&&b.bottom<=m.bottom})()`)
    assert.equal(bannerVisible, true)
    const scrollCheck = await evaluate(`(()=>{const region=document.querySelector('.sensor-preview-readings-scroll');region.scrollLeft=region.scrollWidth;const last=region.querySelector('tbody tr td:last-child').getBoundingClientRect(),r=region.getBoundingClientRect();return {label:region.getAttribute('aria-label'),reachable:last.right<=r.right+1&&last.left>=r.left}})()`)
    assert.equal(scrollCheck.reachable, true); assert.ok(scrollCheck.label.includes('scroll horizontally'))
    const image = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
    await writeFile(join(resolve(output), `sensor-preview-${width}.png`), Buffer.from(image.data, 'base64'))
    console.log(`PASS ${width}px: modal fits; real six-metric layout; sticky demo banner; disabled review; keyboard chip focus; mutations rejected locally`)
  }
  assert.ok(requests.every(url => url.startsWith('file:') || url.startsWith('data:')))
  console.log('PASS network isolation: no HTTP, API, camera or database requests')
} finally {
  socket?.close(); chrome.kill()
  await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve))
}
