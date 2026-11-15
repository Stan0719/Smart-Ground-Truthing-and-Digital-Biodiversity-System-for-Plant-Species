import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

// Standalone offline browser verification: only a generated bundle is served.
// Auth and every application request are mocked; no running application is used.
const root = resolve('src').replaceAll('\\', '/')
const result = await build({
  configFile: false, plugins: [{ name: 'offline-preview-harness', enforce: 'pre',
    resolveId(id) {
      if (id === 'preview-entry') return '\0preview-entry'
      if (id.endsWith('/services/auth')) return '\0preview-auth'
      if (id === 'vue-router') return '\0preview-router'
      if (id.endsWith('/composables/useConservationText')) return '\0preview-text'
    },
    load(id) {
      if (id === '\0preview-auth') return `export const sessionSnapshot=()=>({pending:false,user:{id:'offline-officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}});export const subscribeSession=()=>()=>{};`
      if (id === '\0preview-router') return `export const useRoute=()=>({query:{}});`
      if (id === '\0preview-text') return `import {ref} from 'vue';export const useConservationText=()=>({ct:x=>x,locale:ref('en')});`
      if (id === '\0preview-entry') return `
        import {createApp,h} from 'vue';import {createI18n} from 'vue-i18n';
        import Page from '${root}/views/conservation/ThreatAlertsView.vue';
        import '${root}/styles/conservation.css';import '${root}/styles/officer-typography.css';import '${root}/styles/dashboard-buttons.css';
        window.__requests=[];window.fetch=async(url,options)=>{window.__requests.push({url,method:options?.method||'GET'});if(url!=='/api/data/alerts'||options?.method==='POST')throw Error('Unexpected application transport');return new Response(JSON.stringify({alerts:[],responses:[]}),{headers:{'Content-Type':'application/json'}})};
        createApp({render:()=>h('div',{class:'officer-layout'},h('div',{class:'main-area'},h('main',{class:'conservation-page'},h(Page))))}).use(createI18n({legacy:false,locale:'en',messages:{en:{common:{close:'Close'}}},missingWarn:false,fallbackWarn:false})).mount('#app');`
    },
  }, vue()], define: { 'import.meta.env.DEV': 'true' }, logLevel: 'silent',
  build: { write: false, rollupOptions: { input: 'preview-entry' } },
})
const files = new Map(result.output.map(item => [item.fileName, item.type === 'chunk' ? item.code : item.source]))
const entry = result.output.find(item => item.type === 'chunk' && item.isEntry).fileName
const styles = result.output.filter(item => item.fileName.endsWith('.css')).map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join('')
const server = createServer((req,res) => {
  const path = req.url.split('?')[0].slice(1)
  if (!path) { res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<style>body{margin:0}</style></head><body><div id="app"></div><script type="module" src="/${entry}"></script></body></html>`);return }
  if (!files.has(path)) { res.statusCode=404;res.end();return }
  res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'application/javascript');res.end(files.get(path))
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const profile = mkdtempSync(join(tmpdir(),'threat-preview-browser-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']})
let socket
try {
  const endpoint = await new Promise((resolve,reject) => {
    let output='';const timer=setTimeout(()=>reject(Error('Chrome debugging endpoint timeout')),15000)
    chrome.stderr.on('data',chunk=>{output+=chunk;const match=/DevTools listening on (ws:\/\/\S+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1])}})
    chrome.on('error',reject)
  })
  socket = new WebSocket(endpoint)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let sequence=0;const pending=new Map()
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const waiter=pending.get(message.id);pending.delete(message.id);message.error?waiter.reject(Error(message.error.message)):waiter.resolve(message.result)}})
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})
  const {targetId}=await call('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true})
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
  await call('Runtime.enable',{},sessionId)
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')console.error('Browser exception:',JSON.stringify(m.params))})
  await call('Page.enable',{},sessionId)
  await call('Page.navigate',{url:`http://localhost:${server.address().port}/`},sessionId)
  await evaluate(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Preview Sample Alerts');if(b){clearInterval(timer);b.click();resolve(true)}},30);setTimeout(()=>{clearInterval(timer);reject(Error('Preview control missing: '+document.body.innerText+'; requests='+JSON.stringify(window.__requests)))},10000)})`)
  await evaluate(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(document.querySelectorAll('tbody tr').length===3){clearInterval(timer);resolve(true)}},30);setTimeout(()=>{clearInterval(timer);reject(Error('Sample rows missing'))},10000)})`)
  for (const width of [1440,1024,768,390,320]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},sessionId)
    const metrics=await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const region=document.querySelector('.officer-table-scroll');region.scrollLeft=region.scrollWidth;const action=[...document.querySelectorAll('tbody button')][0];const rect=action.getBoundingClientRect(),r=region.getBoundingClientRect();resolve({page:document.documentElement.scrollWidth,viewport:innerWidth,scrollable:region.scrollWidth>region.clientWidth,actionVisible:rect.left>=r.left&&rect.right<=r.right,rows:document.querySelectorAll('tbody tr').length})})))`)
    assert.ok(metrics.page<=width,`${width}px page overflow: ${JSON.stringify(metrics)}`)
    assert.equal(metrics.rows,3);assert.equal(metrics.actionVisible,true,`${width}px clipped actions`)
    await evaluate(`[...document.querySelectorAll('tbody button')][0].click()`)
    const modal=await evaluate(`({active:!!document.querySelector('[role="dialog"]')?.contains(document.activeElement),scrollLocked:document.documentElement.style.overflow==='hidden',marker:document.querySelector('[role="dialog"]').textContent.includes('SAMPLE PREVIEW'),fits:document.querySelector('[role="dialog"]').getBoundingClientRect().right<=innerWidth})`)
    assert.equal(modal.active,true);assert.equal(modal.scrollLocked,true);assert.equal(modal.marker,true);assert.equal(modal.fits,true)
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},sessionId)
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'},sessionId)
    await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`)
    assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`),false)
    console.log(`PASS ${width}px: no page overflow, 3 rows, actions reachable; modal focus and Escape verified`)
  }
  await evaluate(`[...document.querySelectorAll('tbody button')][0].click()`)
  await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`)
  await evaluate(`(()=>{const box=document.querySelector('textarea');box.value='Offline browser sample decision';box.dispatchEvent(new Event('input',{bubbles:true}));const status=document.querySelector('[role="dialog"] select');status.value='Resolved';status.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await evaluate(`document.querySelector('[role="dialog"] .primary-button').click()`)
  await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`)
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Sample response applied locally. Not saved to database.')`),true)
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Offline browser sample decision')`),true)
  console.log('PASS 320px local decision: status, note, history and feedback updated without transport')
  const requests=await evaluate('window.__requests')
  assert.deepEqual(requests,[{url:'/api/data/alerts',method:'GET'}])
  console.log('PASS offline browser: only the mocked canonical GET was used')
} finally {
  socket?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  // Remove only this test-created temporary Chrome profile, after its process exits.
  await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve))
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()))
  assert.ok(basename(profile).startsWith('threat-preview-browser-'))
  try {rmSync(profile,{recursive:true,force:true,maxRetries:3})} catch {}
}
