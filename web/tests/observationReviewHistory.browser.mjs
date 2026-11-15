import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

// Standalone offline browser verification: only a generated bundle is served.
// Auth and every application request are mocked; no running application is used.
const root = resolve('src').replaceAll('\\', '/')
const screenshots = mkdtempSync(join(tmpdir(), 'observation-dialog-redesign-'))
console.log('Screenshots ' + screenshots)
const result = await build({
  configFile: false, plugins: [{ name: 'offline-history-harness', enforce: 'pre',
    resolveId(id) {
      if (id === 'history-entry') return '\0history-entry'
      if (id.endsWith('/services/auth')) return '\0history-auth'
      if (id === 'vue-router') return '\0history-router'
      },
    load(id) {
      if (id === '\0history-auth') return `export const sessionSnapshot=()=>({pending:false,user:{id:'offline-officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}});export const subscribeSession=()=>()=>{};export const currentUser=async()=>sessionSnapshot().user;`
      if (id === '\0history-router') return `export const useRoute=()=>({query:{}});`
      if (id === root + '/style.css') return readFileSync(id, 'utf8').replace(/^@import[^\n]+\n/, '')
      if (id === '\0history-entry') return `
        import {createApp,h} from 'vue';import {createI18n} from 'vue-i18n';
        import Page from '${root}/views/conservation/ObservationsView.vue';
        import '${root}/style.css';import '${root}/styles/conservation.css';import '${root}/styles/officer-typography.css';import '${root}/styles/dashboard-buttons.css';
        import messages from '${root}/locales/en.json';
        const observation={id:'5d8a3647-e3c3-43fa-b355-aabdddf05f71',plant_id:1,owner_subject:'staff:botanist',origin_type:'subsequent_observation',status:'Approved',revision:4,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-07T01:00:00Z',species_id:1,scientific_name:'Test species',common_name:'Local test plant',reviewed_at:'2026-11-07T06:20:00.123456Z',content:{heightCm:20,healthStatus:'Healthy',lifeStage:'Juvenile',morphology:'Field observation with healthy leaves.',notes:'Height verified during a field visit.',latitude:1.5183143,longitude:110.3301987,accuracy_m:100},assets:[]};
        const pendingObservation={...observation,id:'5d8a3647-e3c3-43fa-b355-aabdddf05f72',status:'Pending Review'};
        const reviews=Array.from({length:5},(_,index)=>({id:'review-'+index,observation_id:observation.id,decision:['Correction Required','Flagged','Correction Required','Rejected','Approved'][index],reviewer_subject:index===3?null:'staff:conservation-officer-'+(1047+index),comment:index===0?'Please provide a clearer leaf close-up and verify the recorded height.':index===4?'<script>window.__historyInjected=true</script>':'Field inspection notes retained for follow-up.',created_at:['2026-11-07T06:20:00.123456Z','2026-11-06T03:10:00.123456Z','2026-11-05T02:30:00.000001Z','2026-11-04T00:15:00.000001Z','2026-11-03T03:10:00.000001Z'][index]}));
        window.__historyMode='standard';window.__olderStep=0;window.__historyFailure=false;
        window.__requests=[];window.fetch=async(url,options)=>{
          window.__requests.push({url,method:options?.method||'GET'});
          if(options?.method==='POST')throw Error('Unexpected mutation');
          let result;
          if(url.startsWith('/api/data/observations/')&&url.includes('/reviews?')) {
            const id=url.split('/')[4],mode=window.__historyMode;
            if(mode==='error')return new Response(JSON.stringify({error:'Offline fixture error'}),{status:503,headers:{'Content-Type':'application/json'}});
            if(url.includes('cursor='))return new Promise(resolve=>window.__releaseOlder=()=>{
              if(window.__historyFailure){resolve(new Response(JSON.stringify({error:'Offline fixture error'}),{status:503,headers:{'Content-Type':'application/json'}}));return}
              window.__olderStep++;
              const rows=[{...reviews[4],id:'older-'+window.__olderStep,observation_id:id}];
              resolve(new Response(JSON.stringify({observation_id:id,reviews:rows,page:{limit:50,has_more:window.__olderStep<2,next_cursor:window.__olderStep<2?'older-next':null}}),{headers:{'Content-Type':'application/json'}}));
            });
            const rows=mode==='empty'?[]:mode==='one'?reviews.slice(0,1):reviews;
            result={observation_id:id,reviews:rows.map(review=>({...review,observation_id:id})),page:{limit:50,has_more:mode==='pages',next_cursor:mode==='pages'?'older':null}};
          }
          else if(url.startsWith('/api/observations?'))result={observations:[observation,pendingObservation],page:{has_more:false,next_cursor:null}};
          else if(url==='/api/observations/'+observation.id)result={observation};
          else if(url==='/api/observations/'+pendingObservation.id)result={observation:window.__longObservation?{...pendingObservation,content:{...pendingObservation.content,notes:'Long field notes describing the measured plant and surrounding habitat. '.repeat(100)}}:pendingObservation};
          else throw Error('Unexpected application transport '+url);
          return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}})
        };
        createApp({render:()=>h('div',{class:'officer-layout'},h('div',{class:'main-area'},h('main',{class:'conservation-page'},h(Page))))}).use(createI18n({legacy:false,locale:'en',messages:{en:messages},missingWarn:false,fallbackWarn:false})).mount('#app');`
    },
  }, vue()], logLevel: 'silent',
  build: { write: false, rollupOptions: { input: 'history-entry' } },
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
const profile = mkdtempSync(join(tmpdir(),'observation-history-browser-'))
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
  await evaluate(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{if([...document.querySelectorAll('button')].some(button=>button.textContent==='View Details')){clearInterval(timer);resolve(true)}},30);setTimeout(()=>{clearInterval(timer);reject(Error('Observation list missing: '+document.body.innerText))},10000)})`)

  const settle = () => evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  const waitFor = expression => evaluate(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true)}},20);setTimeout(()=>{clearInterval(timer);reject(Error('Timed out waiting for ${expression.replaceAll("'",'')}'))},8000)})`)
  const clickText = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button');button.focus();button.click()})()`)
  const key = async (name, code, modifiers=0) => {
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:code,modifiers},sessionId)
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code,modifiers},sessionId)
    await settle()
  }
  const screenshot = async name => {
    await settle()
    const result = await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId)
    writeFileSync(join(screenshots,name+'.png'),Buffer.from(result.data,'base64'))
  }
  const close = async () => { await evaluate(`document.querySelector('[role="dialog"] .close-button').click()`); await settle() }
  const open = async (kind='View Details',mode='standard') => {
    await evaluate(`window.__historyMode=${JSON.stringify(mode)};window.__olderStep=0;window.__historyFailure=false;window.__releaseOlder=null`)
    await clickText(kind)
    await waitFor(`document.querySelector('.observation-review-history')`)
    await waitFor(`!document.querySelector('.observation-review-history').getAttribute('aria-busy') || document.querySelector('.observation-review-history').getAttribute('aria-busy')==='false'`)
    await settle()
  }
  for (const width of [1440,1024,768,390,320]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},sessionId)
    for(const mode of ['View Details','Review']) {
      await open(mode)
      const metrics = await evaluate(`(()=>{
        const modal=document.querySelector('[role="dialog"]'),history=modal.querySelector('.observation-review-history'),r=modal.getBoundingClientRect();
        return {pageWidth:document.documentElement.scrollWidth,fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:modal.scrollWidth>modal.clientWidth,historyOverflow:history.scrollWidth>history.clientWidth,rows:history.querySelectorAll('.review-event').length,columns:getComputedStyle(modal.querySelector('.observation-dialog-columns')).gridTemplateColumns.split(' ').length,actions:modal.querySelectorAll('.observation-decision-actions button').length,focusInside:modal.contains(document.activeElement),locked:document.documentElement.style.overflow==='hidden',backgroundInert:document.querySelectorAll('[inert]').length>0,firstDate:history.querySelector('time').textContent,created:[...modal.querySelectorAll('.observation-details dd')][3].textContent}
      })()`)
      assert.ok(metrics.pageWidth<=width); assert.equal(metrics.fits,true); assert.equal(metrics.overflow,false); assert.equal(metrics.historyOverflow,false)
      assert.equal(metrics.rows,3); assert.equal(metrics.actions,mode==='Review'?4:0)
      assert.equal(metrics.columns,width>900?2:1);assert.equal(metrics.focusInside,true);assert.equal(metrics.locked,true);assert.equal(metrics.backgroundInert,true)
      assert.equal(metrics.firstDate,'7 Nov 2026, 14:20');assert.equal(metrics.created,'1 Nov 2026, 08:00')
      // The last focusable element wraps to Close, and Shift+Tab wraps back.
      await evaluate(`document.querySelector('[role="dialog"] .close-button').focus()`)
      await key('Tab',9,8)
      assert.equal(await evaluate(`document.querySelector('[role="dialog"]').contains(document.activeElement)`),true)
      await key('Tab',9)
      assert.equal(await evaluate(`document.activeElement===document.querySelector('[role="dialog"] .close-button')`),true)
      await evaluate(`document.querySelector('[role="dialog"]').scrollTop=document.querySelector('[role="dialog"]').scrollHeight`)
      await settle()
      const sticky = await evaluate(`(()=>{const m=document.querySelector('[role="dialog"]').getBoundingClientRect(),h=document.querySelector('[role="dialog"] .modal-header').getBoundingClientRect(),c=document.querySelector('[role="dialog"] .close-button').getBoundingClientRect();return h.top>=m.top&&c.top>=m.top&&c.bottom<=m.bottom})()`)
      assert.equal(sticky,true)
      if(mode==='Review') {
        await evaluate(`document.querySelector('.officer-review textarea').focus()`);await settle()
        assert.equal(await evaluate(`document.querySelector('.officer-review textarea').getBoundingClientRect().top>=document.querySelector('[role="dialog"] .modal-header').getBoundingClientRect().bottom`),true)
      }
      if([1440,390,320].includes(width)) {
        await evaluate(`document.querySelector('[role="dialog"]').scrollTop=0`)
        await screenshot(`${width}-${mode==='Review'?'review':'view'}`)
      }
      await key('Escape',27)
      assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`),false)
      assert.equal(await evaluate(`document.activeElement.textContent.trim()`),mode)
      assert.equal(await evaluate(`document.documentElement.style.overflow`),'')
      console.log(`PASS ${width}px ${mode}: layout, latest three, sticky Close, focus trap/return and scroll lock`)
    }
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId)
  await open('Review','pages')
  const beforeExpand = await evaluate(`window.__requests.length`)
  await clickText('View more reviews');await settle()
  assert.equal(await evaluate(`document.querySelectorAll('.review-event').length`),5)
  await clickText('Show fewer reviews');await settle()
  assert.equal(await evaluate(`document.querySelectorAll('.review-event').length`),3)
  assert.equal(await evaluate(`window.__requests.length`),beforeExpand)
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'View more reviews')
  await clickText('View more reviews');await settle()
  await clickText('Load older decisions');await waitFor(`typeof window.__releaseOlder==='function'`)
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'Load older decisions')
  assert.equal(await evaluate(`document.activeElement.disabled`),false)
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-disabled')`),'true')
  await evaluate(`window.__releaseOlder()`);await waitFor(`document.querySelectorAll('.review-event').length===6`);await settle()
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'Load older decisions')
  await evaluate(`window.__releaseOlder=null`);await clickText('Load older decisions');await waitFor(`typeof window.__releaseOlder==='function'`)
  await evaluate(`window.__releaseOlder()`);await waitFor(`document.querySelectorAll('.review-event').length===7`);await settle()
  assert.equal(await evaluate(`document.activeElement.classList.contains('history-heading')`),true)
  assert.equal(await evaluate(`window.__historyInjected===true`),false)
  await close()
  await open('Review','pages');await clickText('View more reviews');await settle()
  await evaluate(`window.__historyFailure=true`);await clickText('Load older decisions');await waitFor(`typeof window.__releaseOlder==='function'`)
  await evaluate(`window.__releaseOlder()`);await waitFor(`!!document.querySelector('.observation-review-history [role="alert"]')`);await settle()
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'Retry')
  await evaluate(`window.__historyFailure=false;window.__releaseOlder=null`);await clickText('Retry')
  await waitFor(`typeof window.__releaseOlder==='function'`)
  assert.equal(await evaluate(`document.activeElement.classList.contains('history-heading')`),true)
  await evaluate(`window.__releaseOlder()`);await waitFor(`document.querySelectorAll('.review-event').length===6`);await settle()
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'Load older decisions')
  // Closing during a pending page must leave focus on the invoking control.
  await evaluate(`window.__releaseOlder=null`);await clickText('Load older decisions');await waitFor(`typeof window.__releaseOlder==='function'`)
  await close();await evaluate(`window.__releaseOlder()`);await settle()
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'Review')
  assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`),false)
  await open('View Details','empty')
  assert.equal(await evaluate(`document.querySelector('.observation-review-history').textContent.includes('No review history recorded yet.')`),true)
  await close()
  await open('View Details','one')
  assert.equal(await evaluate(`document.querySelectorAll('.review-event').length`),1)
  assert.equal(await evaluate(`!!document.querySelector('.history-toggle')`),false)
  await close()
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1400,deviceScaleFactor:1,mobile:false},sessionId)
  await open('Review')
  await screenshot('1440-review-full')
  await close()
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false},sessionId)
  await open('Review')
  await evaluate(`document.querySelector('.officer-review textarea').focus()`);await settle()
  await screenshot('390-review-controls')
  await clickText('View more reviews');await settle()
  await evaluate(`document.querySelector('.observation-review-history').scrollIntoView({block:'end'})`)
  await screenshot('390-history-expanded')
  await close()
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false},sessionId)
  await open('Review')
  assert.equal(await evaluate(`document.querySelector('.officer-review textarea').placeholder`),'Record the observation decision or required action')
  assert.equal(await evaluate(`document.querySelector('.officer-review').textContent.includes('Status: Pending Review')`),false)
  assert.equal(await evaluate(`document.querySelector('.observation-review-history').textContent.includes('Malaysia time')`),false)
  assert.equal(await evaluate(`(()=>{const f=document.querySelector('.observation-decision-actions'),c=document.querySelector('.observation-dialog-columns');return f.parentElement===c.parentElement&&f.getBoundingClientRect().width>c.getBoundingClientRect().width-2&&new Set([...f.querySelectorAll('button')].map(b=>b.getBoundingClientRect().top)).size===1})()`),true)
  for(const decision of ['Reject','Request Correction']) {
    await clickText(decision);await settle()
    assert.equal(await evaluate(`document.querySelector('.action-feedback--error').textContent.includes('Enter a review comment for rejection, correction, or flagging.')`),true)
    assert.equal(await evaluate(`document.querySelector('.observation-comment-validation').getAttribute('role')`),'alert')
    assert.equal(await evaluate(`document.querySelector('.officer-review textarea').getAttribute('aria-describedby')`),'observation-review-comment-error')
    assert.equal(await evaluate(`document.querySelector('.officer-review textarea').getAttribute('aria-invalid')`),'true')
    await evaluate(`document.querySelector('.officer-review textarea').focus()`);await settle()
    await screenshot('1440-'+decision.toLowerCase().replaceAll(' ','-')+'-comment-error')
  }
  await close()
  // Keep the complete right composition beside long, independently scrolling details.
  await evaluate(`window.__longObservation=true`)
  for (const [width,height] of [[1440,900],[1024,900],[1440,480],[1024,480]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId)
    await open('Review');await settle()
    const initial=await evaluate(`(()=>{
      const column=document.querySelector('.observation-review-column'),content=column.querySelector('.observation-review-content'),form=column.querySelector('.officer-review'),history=column.querySelector('.observation-review-history'),actions=document.querySelector('.observation-decision-actions');
      return {position:getComputedStyle(column).position,formPosition:getComputedStyle(form).position,gap:history.getBoundingClientRect().top-form.getBoundingClientRect().bottom,order:!!(history.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING),insideForm:!!form.querySelector('.observation-decision-actions'),footerParent:actions.parentElement===column,alignment:getComputedStyle(actions).justifyContent,tabindex:content.tabIndex,role:content.getAttribute('role'),contentOverflow:content.scrollHeight>content.clientHeight}
    })()`)
    assert.equal(initial.position,'sticky');assert.equal(initial.formPosition,'static')
    assert.ok(initial.gap>=23&&initial.gap<=25);assert.equal(initial.order,true)
    assert.equal(initial.insideForm,false);assert.equal(initial.footerParent,false);assert.equal(initial.alignment,'flex-end')
    assert.equal(initial.tabindex,0);assert.equal(initial.role,'region');assert.equal(initial.contentOverflow,true)
    for (const distance of [300,600,1200,100000]) {
      await evaluate(`document.querySelector('.modal-card').scrollTop=${distance}`);await settle()
      const geometry=await evaluate(`(()=>{
        const column=document.querySelector('.observation-review-column'),header=document.querySelector('.modal-header'),card=document.querySelector('.modal-card'),actions=document.querySelector('.observation-decision-actions');
        const p=column.getBoundingClientRect(),h=header.getBoundingClientRect(),c=card.getBoundingClientRect(),a=actions.getBoundingClientRect();
        return {top:p.top,bottom:p.bottom,headerBottom:h.bottom,cardBottom:c.bottom,footerBottom:a.bottom,footerTop:a.top,offset:parseFloat(getComputedStyle(column).top),headerHeight:h.height,contentPosition:getComputedStyle(column.querySelector('.observation-review-content')).position}
      })()`)
      assert.ok(Math.abs(geometry.offset-geometry.headerHeight-12)<1)
      assert.ok(Math.abs(geometry.top-geometry.headerBottom-12)<2,JSON.stringify({width,height,distance,...geometry}))
      assert.ok(geometry.bottom<=geometry.cardBottom-10)
      assert.ok(geometry.footerBottom<=geometry.cardBottom+1)
      assert.ok(geometry.footerTop>=geometry.bottom-1)
      if(distance===600) await screenshot(width+'x'+height+'-sticky-column')
    }
    // The content scrolls and expands history while the footer remains in place.
    const footerBefore=await evaluate(`document.querySelector('.observation-decision-actions').getBoundingClientRect().bottom`)
    await clickText('View more reviews');await settle()
    await evaluate(`document.querySelector('.observation-review-content').scrollTop=100000`);await settle()
    assert.equal(await evaluate(`document.querySelectorAll('.review-event').length`),5)
    assert.equal(await evaluate(`document.querySelector('.observation-decision-actions').getBoundingClientRect().bottom`),footerBefore)
    await evaluate(`document.querySelector('.observation-review-content').focus()`)
    await key('Home',36);await key('PageDown',34)
    assert.equal(await evaluate(`document.activeElement.classList.contains('observation-review-content')`),true)
    for (const index of [0,1,2,3]) {
      await evaluate(`document.querySelectorAll('.observation-decision-actions button')[${index}].focus()`);await settle()
      assert.equal(await evaluate(`(()=>{const b=document.activeElement.getBoundingClientRect(),h=document.querySelector('.modal-header').getBoundingClientRect(),c=document.querySelector('.modal-card').getBoundingClientRect();return b.top>=h.bottom&&b.bottom<=c.bottom})()`),true)
    }
    await close()
  }
  // Mobile and extremely short windows return all sections to normal flow.
  for (const [width,height] of [[768,900],[390,900],[320,900],[1440,360]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId)
    await open('Review','empty');await settle()
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.observation-review-column')).position`),'static')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.observation-review-content')).display`),'contents')
    await evaluate(`document.querySelector('.observation-decision-actions button:last-child').focus()`);await settle()
    assert.equal(await evaluate(`(()=>{const b=document.activeElement.getBoundingClientRect(),h=document.querySelector('.modal-header').getBoundingClientRect(),c=document.querySelector('.modal-card').getBoundingClientRect();return b.top>=h.bottom&&b.bottom<=c.bottom})()`),true)
    assert.equal(await evaluate(`document.querySelector('.modal-card').scrollWidth<=document.querySelector('.modal-card').clientWidth`),true)
    await close()
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1024,height:480,deviceScaleFactor:1,mobile:false},sessionId)
  await open('Review','empty')
  await clickText('Reject')
  await waitFor(`!!document.querySelector('.officer-review [role="alert"]')`)
  // Long localized feedback shares the one right-side scroll area.
  await evaluate(`document.querySelector('.officer-review [role="alert"]').textContent='Please provide the required review feedback before continuing. '.repeat(100)`);await settle()
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.observation-review-column')).position`),'sticky')
  await evaluate(`document.querySelector('.officer-review textarea').focus()`);await settle()
  assert.equal(await evaluate(`(()=>{const t=document.activeElement.getBoundingClientRect(),c=document.querySelector('.observation-review-content').getBoundingClientRect();return t.top>=c.top-1&&t.top<c.bottom})()`),true)
  await evaluate(`document.querySelector('.observation-decision-actions button:last-child').focus()`);await settle()
  assert.equal(await evaluate(`(()=>{const b=document.activeElement.getBoundingClientRect(),h=document.querySelector('.modal-header').getBoundingClientRect(),c=document.querySelector('.modal-card').getBoundingClientRect();return b.top>=h.bottom&&b.bottom<=c.bottom})()`),true)
  await screenshot('1024-long-validation-footer')
  await close();await evaluate(`window.__longObservation=false`)
  console.log('PASS complete sticky column, compact section spacing, bottom-right footer, bounded history, short viewport and mobile fallback')
  const requests=await evaluate('window.__requests')
  assert.ok(requests.every(request=>request.method==='GET'))
  console.log('PASS expansion without requests, page merging, loading/final/error focus, stale completion and empty/one histories')
  console.log('SCREENSHOTS '+screenshots)

} finally {
  socket?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  // Remove only this test-created temporary Chrome profile, after its process exits.
  await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve))
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()))
  assert.ok(basename(profile).startsWith('observation-history-browser-'))
  try {rmSync(profile,{recursive:true,force:true,maxRetries:3})} catch {}
}
