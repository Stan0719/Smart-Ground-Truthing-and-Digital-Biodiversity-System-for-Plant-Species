<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from './AppModal.vue'
import { formatPlantId } from '../../utils/plantId'
const props=defineProps<{plantId:string|null}>()
const emit=defineEmits<{close:[];deleted:[]}>()
const {t}=useI18n()
const text=(key:string)=>t('officerPlantDelete.'+key)
const busy=ref(false),revision=ref(''),message=ref(''),uncertain=ref(false),done=ref(false)
let generation=0,controller:AbortController|null=null
async function request(method:string){
 const response=await fetch('/api/data/officer/plants/'+encodeURIComponent(props.plantId!)+(method==='GET'?'/deletion':''),{method,credentials:'same-origin',signal:AbortSignal.any([controller!.signal,AbortSignal.timeout(15000)]),...(method==='DELETE'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:revision.value})}:{})})
 const value=await response.json()
 if(!response.ok)throw Object.assign(Error(),{status:response.status,code:value.code})
 return value
}
async function check(){
 if(busy.value)return
 controller?.abort();controller=new AbortController();const token=++generation
 busy.value=true;revision.value='';message.value=''
 try{const result=await request('GET');if(token!==generation)return
 if(!/^[a-f0-9]{64}$/.test(result.revision))throw Error()
 revision.value=result.revision;uncertain.value=false
 }catch(error){if(token!==generation)return;const cause=error as {status?:number;code?:string}
 if(uncertain.value&&cause.status===404){done.value=true;uncertain.value=false;message.value=text('absent');emit('deleted')}
 else message.value=text(cause.code==='PLANT_DELETE_REFERENCED'?'referenced':cause.status===401||cause.status===403?'permission':'unavailable')
 }finally{if(token===generation)busy.value=false}
}
async function remove(){
 if(busy.value||!revision.value||uncertain.value||done.value)return
 const token=generation;busy.value=true
 try{const result=await request('DELETE');if(token!==generation)return;if(result.deleted!==true)throw Error()
 done.value=true;revision.value='';message.value=text('saved');emit('deleted')
 }catch(error){if(token!==generation)return;const cause=error as {status?:number;code?:string};revision.value=''
 uncertain.value=!cause.status||cause.status>=500
 message.value=text(cause.code==='PLANT_DELETE_REFERENCED'?'referenced':cause.status===409?'conflict':cause.status===401||cause.status===403?'permission':uncertain.value?'uncertain':'unavailable')
 }finally{if(token===generation)busy.value=false}
}
watch(()=>props.plantId,()=>{generation++;controller?.abort();busy.value=false;done.value=false;uncertain.value=false;revision.value='';if(props.plantId)void check()},{immediate:true})
onBeforeUnmount(()=>{generation++;controller?.abort()})
</script>
<template>
 <AppModal v-if="plantId" class="plant-delete-dialog" :title="text('title')" :close-on-backdrop="false" :close-on-escape="false" danger-backdrop accessible @close="!busy&&emit('close')">
  <template #title>
   <span class="plant-delete-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13h32M17 13V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M12 13l2 29h20l2-29M20 21v13m8-13v13"/></svg></span>
   <span>{{ text('title') }}</span>
  </template>
  <div class="plant-delete-content">
   <p class="plant-delete-question">{{ text('confirm') }} <strong>{{ formatPlantId(plantId) }}</strong>?</p>
   <p v-if="busy" class="plant-delete-state" role="status">{{ text('checking') }}</p>
   <p v-if="message" class="plant-delete-state" :role="done?'status':'alert'">{{ message }}</p>
   <footer class="plant-delete-actions">
    <button type="button" class="plant-delete-close" :disabled="busy" @click="emit('close')">{{ text('close') }}</button>
    <button v-if="!revision&&!done" type="button" class="plant-delete-verify" :disabled="busy" @click="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>{{ text('verify') }}</button>
    <button v-if="!done" type="button" class="plant-delete-confirm" :disabled="busy||!revision||uncertain" @click="remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>{{ text('title') }}</button>
   </footer>
  </div>
 </AppModal>
</template>
<style scoped>
.plant-delete-dialog :deep(.modal-card) { box-sizing:border-box;width:min(600px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;padding:24px;border:1px solid #e3e5e3;border-radius:16px; }
.plant-delete-dialog :deep(.modal-header) { position:relative;display:block;margin:0 0 20px;padding-right:40px;text-align:center; }
.plant-delete-dialog :deep(.custom-modal-title) { width:100%; }
.plant-delete-dialog.plant-delete-dialog.plant-delete-dialog :deep(.modal-header h2) { display:flex;flex-direction:column;align-items:center;gap:10px;margin:0;color:#174c38;font-family:inherit;font-size:22px;line-height:30px;text-align:center; }
.plant-delete-dialog.plant-delete-dialog.plant-delete-dialog :deep(.close-button) { position:absolute;top:0;right:0;width:44px;height:44px;min-width:44px;min-height:44px;border-radius:8px; }
.plant-delete-icon { display:grid;width:52px;height:52px;place-items:center;border-radius:50%;background:#faeeee;color:#bd3d35; }
.plant-delete-icon svg { width:30px;height:30px; }
.plant-delete-content { display:flex;flex-direction:column;align-items:center;min-width:0;text-align:center; }
.plant-delete-question { margin:0 0 8px;color:#174331;font-size:16px;line-height:24px;overflow-wrap:anywhere; }
.plant-delete-state { max-width:100%;margin:0 0 8px;color:#344c45;font-size:14px;line-height:22px;overflow-wrap:anywhere; }
.plant-delete-actions { display:grid;width:100%;grid-template-columns:minmax(0,.85fr) minmax(0,1.35fr) minmax(0,1.15fr);gap:10px;margin-top:16px; }
.plant-delete-actions button { box-sizing:border-box;display:flex;min-width:0;min-height:44px;align-items:center;justify-content:center;gap:8px;padding:8px 10px;border:1px solid transparent;border-radius:9px;font-family:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer; }
.plant-delete-actions svg { width:18px;height:18px;flex:none; }
.plant-delete-actions button:disabled { opacity:.55;cursor:not-allowed; }
.plant-delete-close { border-color:#557b65!important;background:#fff;color:#174331; }
.plant-delete-verify { background:#e4efd6;color:#174331; }
.plant-delete-confirm { background:#b63e37;color:#fff; }
.plant-delete-actions button:focus-visible,.plant-delete-dialog :deep(.close-button:focus-visible) { outline:3px solid #245443;outline-offset:3px; }
@media(max-width:560px) { .plant-delete-dialog :deep(.modal-card){width:calc(100vw - 20px);max-width:calc(100vw - 20px);max-height:calc(100dvh - 20px);padding:16px}.plant-delete-dialog :deep(.modal-header){margin-bottom:16px;padding-right:48px}.plant-delete-dialog.plant-delete-dialog.plant-delete-dialog :deep(.modal-header h2){font-size:20px;line-height:28px}.plant-delete-icon{width:44px;height:44px}.plant-delete-icon svg{width:26px;height:26px}.plant-delete-question{font-size:15px;line-height:22px}.plant-delete-actions{grid-template-columns:minmax(0,1fr);gap:8px;margin-top:12px}.plant-delete-actions button{min-height:44px}.plant-delete-verify{grid-column:auto;grid-row:auto} }
@media(prefers-reduced-motion:reduce) { .plant-delete-actions button { transition:none; } }
</style>
