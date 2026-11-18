// Standalone OFFLINE artifact builder. Not imported by the application or its routes.
// Usage from web/: node tests/sensorAlertPreview.mjs <absolute-output.html>
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'

export const PREVIEW_BANNER = 'DEMO PREVIEW — NOT REAL ALERT DATA'
const webRoot = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/')

export function previewOnlySource(source) {
  // Transform an in-memory copy only; fail rather than silently lose the safety gate.
  const submit = 'const submitResponse = async () => {'
  if (!source.includes(submit) || !source.includes('<div class="investigation-status">')) throw Error('Preview source contract changed')
  return source.replace(submit, `${submit}\n  return // Offline preview: review mutations are disabled.\n`)
    .replace('</script>', `onMounted(async () => { await loadAlerts(); if (alerts.value[0]) openAlert(alerts.value[0]) })\n</script>`)
    .replace('<div class="investigation-status">', `<div class="sensor-demo-banner" role="note">${PREVIEW_BANNER}</div><div class="investigation-status">`)
    .replace(/(<table class="same-event-readings">[\s\S]*?<\/table>)/, '<div class="sensor-preview-readings-scroll" tabindex="0" role="region" aria-label="Same-event sensor readings; scroll horizontally for all columns">$1</div>')
    .replace(/:disabled="[^"]*"/g, ':disabled="true"')
    .replace('@click="submitResponse"', '@click.prevent')
}

export async function buildSensorPreview() {
  const result = await build({
    root: webRoot, configFile: false, envDir: false, publicDir: false, logLevel: 'silent',
    plugins: [{ name: 'isolated-sensor-preview', enforce: 'pre',
      resolveId(id) {
        if (id === 'sensor-preview-entry') return '\0sensor-preview-entry'
        if (id.endsWith('/services/auth')) return '\0sensor-preview-auth'
        if (id === 'vue-router') return '\0sensor-preview-router'
        if (id.endsWith('/composables/useConservationText')) return '\0sensor-preview-text'
      },
      transform(source, id) {
        if (id.replaceAll('\\', '/') === `${webRoot}src/views/conservation/ThreatAlertsView.vue`) return previewOnlySource(source)
      },
      load(id) {
        if (id === '\0sensor-preview-auth') return `export const sessionSnapshot=()=>({pending:false,user:{id:'isolated-fixture-officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}});export const subscribeSession=()=>()=>{};`
        if (id === '\0sensor-preview-router') return `export const useRoute=()=>({query:{}});`
        if (id === '\0sensor-preview-text') return `import {ref} from 'vue';export const useConservationText=()=>({ct:x=>x,locale:ref('en')});`
        if (id === '\0sensor-preview-entry') return `
          import {createApp,h} from 'vue';import {createI18n} from 'vue-i18n';
          import Page from '${webRoot}src/views/conservation/ThreatAlertsView.vue';
          import {sensorAlertFixture} from '${webRoot}tests/fixtures/sensorAlertContext.mjs';
          import '${webRoot}src/styles/conservation.css';
          import '${webRoot}src/styles/officer-typography.css';
          import '${webRoot}src/styles/dashboard-buttons.css';
          const fixture=sensorAlertFixture();window.__previewRequests=[];
          const blocked=()=>Promise.reject(Error('Offline preview: transport disabled'));
          window.fetch=async(url,options)=>{
            const method=options?.method||'GET';window.__previewRequests.push({url,method});
            if(method!=='GET')return blocked();
            if(url==='/api/data/alerts')return Response.json({alerts:[fixture.alert],responses:[]});
            if(url==='/api/data/alerts/'+fixture.alert.id+'/context')return Response.json(fixture.context);
            if(url==='/api/data/alerts/current-assignments?ids='+fixture.alert.id)return Response.json({contract_version:1,assignments:[{alert_id:fixture.alert.id,...fixture.assignment}]});
            return blocked();
          };
          window.XMLHttpRequest=class{constructor(){throw Error('Offline preview: transport disabled')}};
          window.WebSocket=class{constructor(){throw Error('Offline preview: transport disabled')}};
          const app=createApp({render:()=>h('div',{class:'officer-layout'},h('div',{class:'main-area'},h('main',{class:'conservation-page'},h(Page))))});
          app.component('RouterLink',{inheritAttrs:false,props:['to'],setup:(_,{attrs,slots})=>()=>h('a',{...attrs,href:'#','aria-disabled':'true',onClick:e=>e.preventDefault()},slots.default?.())});
          app.use(createI18n({legacy:false,locale:'en',messages:{en:{common:{close:'Close'}}},missingWarn:false,fallbackWarn:false})).mount('#app');`
      },
    }, vue()],
    define: { 'import.meta.env.DEV': 'false' },
    build: { write: false, minify: true, rollupOptions: { input: 'sensor-preview-entry', output: { codeSplitting: false } } },
  })
  const js = result.output.filter(f => f.type === 'chunk').map(f => f.code).join('\n').replaceAll('</script', '<\\/script')
  const css = result.output.filter(f => f.fileName.endsWith('.css')).map(f => f.source).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
    <title>Sensor Alert — Offline Design Preview</title><style>${css}
    body{margin:0;background:#f3f6f2;font-family:'Poppins',Arial,sans-serif}.sensor-demo-banner{position:sticky;top:0;z-index:2;padding:12px 15px;margin-bottom:16px;background:#fff1db;color:#714b11;border:1px solid #b99149;border-radius:8px;font-size:13px;font-weight:800;line-height:1.5}
    .preview-heading{padding:18px 24px;color:#245a46}.preview-heading p{font-size:13px}a[aria-disabled]{cursor:default}
    .sensor-preview-readings-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}.sensor-preview-readings-scroll:focus-visible{outline:3px solid #33745d;outline-offset:-3px}
    </style></head><body><header class="preview-heading"><strong>${PREVIEW_BANNER}</strong><p>Offline design preview. All readings and the Plant assignment are illustrative. Review actions and Plant navigation are disabled.</p></header><div id="app"></div><script>${js}</script></body></html>`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2]
  if (!output || !/\.html$/i.test(output)) throw Error('Supply an output .html path; no application server is started.')
  await writeFile(resolve(output), await buildSensorPreview(), 'utf8')
  console.log(`Offline Sensor modal preview: ${resolve(output)}`)
}
