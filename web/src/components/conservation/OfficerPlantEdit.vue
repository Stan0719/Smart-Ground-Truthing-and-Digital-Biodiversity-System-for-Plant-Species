<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from './AppModal.vue'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
const props=defineProps<{ plantId: string | null }>()
const emit=defineEmits<{close:[];saved:[]}>()
const {t}=useI18n()
const label=(key:string)=>t('officerPlantEdit.'+key)
const name=ref(''),reason=ref(''),revision=ref(''),loading=ref(false),saving=ref(false),error=ref(''),validation=ref(false),blocked=ref(true)
const edits=ref<{id:string;actor:string;created_at:string;before:string;after:string;reason:string}[]>([])
const checked=ref(false),readback=ref(false),saved=ref(false)
const currentName=ref('')
let generation=0,controller:AbortController|null=null,disposed=false
const session=ref(sessionSnapshot())
const ready=()=>!session.value.pending&&session.value.user?.role==='Conservation Officer'&&session.value.user.status==='Active'&&!session.value.user.mustChangePassword
async function request(path:string,method='GET',body?:unknown){
 const response=await fetch('/api/data/officer/plants/'+encodeURIComponent(props.plantId!)+path,{method,credentials:'same-origin',signal:AbortSignal.any([controller!.signal,AbortSignal.timeout(15000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
 const value=await response.json()
 if(!response.ok)throw Object.assign(Error('Request failed'),{status:response.status,code:value.code})
 return value
}
async function load(preserve=false){
 controller?.abort();controller=new AbortController();const token=++generation
 blocked.value=true;loading.value=true;error.value='';checked.value=false
 try{
  if(!ready())throw Object.assign(Error(),{status:403})
  const value=await request('/edit')
  if(disposed||token!==generation||!ready())return
  if(value.plant?.id!==props.plantId||typeof value.plant.scientific_name!=='string'||!/^[a-f0-9]{64}$/.test(value.revision))throw Error('Invalid response')
  if(!preserve)name.value=value.plant.scientific_name
  currentName.value=value.plant.scientific_name
  revision.value=value.revision;blocked.value=false
  const history=await request('/edits')
  if(disposed||token!==generation||!ready())return
  if(!Array.isArray(history.edits))throw Error('Invalid history')
  edits.value=history.edits
 }catch(cause){if(token===generation){blocked.value=true;error.value=label((cause as {code?:string})?.code==='PLANT_EDIT_ACTIVE_PROPOSAL'?'active':(cause as {status?:number})?.status===403?'permission':'unavailable')}}
 finally{if(token===generation)loading.value=false}
}
async function save(){
 if(saving.value||loading.value||blocked.value||!ready()||saved.value||(readback.value&&!checked.value))return
 validation.value=true
 if(!name.value.trim()||name.value.trim().length>200||!reason.value.trim()||reason.value.trim().length>4000)return
 saving.value=true;const token=generation
 try{
  const value=await request('','PATCH',{scientific_name:name.value.trim(),reason:reason.value.trim(),revision:revision.value})
  if(disposed||token!==generation||!ready())return
  if(value.saved!==true)throw Error('Unverified save')
  saved.value=true;blocked.value=true;emit('saved')
 }catch(cause){if(token===generation){blocked.value=true;readback.value=true;checked.value=false;const status=(cause as {status?:number})?.status;error.value=label(status===409?'conflict':status===400?'invalid':status===401||status===403?'permission':'uncertain')}}
 finally{if(token===generation)saving.value=false}
}
const unsubscribe=subscribeSession((user,pending)=>{session.value={user,pending};if(!ready()){controller?.abort();generation++;blocked.value=true;loading.value=false;saving.value=false;emit('close')}})
watch(()=>props.plantId,()=>{name.value='';reason.value='';edits.value=[];saved.value=false;readback.value=false;validation.value=false;if(props.plantId)void load()}, {immediate:true})
onBeforeUnmount(()=>{disposed=true;generation++;controller?.abort();unsubscribe()})
</script>
<template>
 <AppModal v-if="plantId" :title="label('title')" wide accessible @close="!saving&&emit('close')">
  <p v-if="loading" role="status">{{ label('loading') }}</p>
  <p v-if="saved" role="status" class="edit-success">{{ label('saved') }}</p>
  <div v-if="error" role="alert" class="edit-error"><p>{{ error }}</p><button type="button" class="secondary-button" :disabled="loading||saving" @click="load(true)">{{ label('refresh') }}</button></div>
  <form class="officer-edit-form" @submit.prevent="save">
   <label>{{ label('name') }}<input v-model="name" maxlength="200" :disabled="loading||saving||saved||blocked" :aria-invalid="validation&&!name.trim()" /><span v-if="validation&&!name.trim()" class="field-error">{{ label('required') }}</span></label>
   <label>{{ label('reason') }}<textarea v-model="reason" maxlength="4000" rows="3" :disabled="loading||saving||saved||blocked" :aria-invalid="validation&&!reason.trim()" /><span v-if="validation&&!reason.trim()" class="field-error">{{ label('required') }}</span></label>
   <p class="restriction">{{ label('restriction') }}</p>
   <p v-if="readback&&!blocked&&!saved">{{ label('latest') }}: {{ currentName }}</p>
   <label v-if="readback&&!blocked&&!saved"><input v-model="checked" type="checkbox" />{{ label('inspect') }}</label>
   <details v-if="edits.length"><summary>{{ label('history') }}</summary><article v-for="edit in edits" :key="edit.id"><p>{{ edit.before }} → {{ edit.after }}</p><p>{{ edit.actor }} · {{ new Date(edit.created_at).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false}) }}</p><p>{{ edit.reason }}</p></article></details>
   <footer><button class="secondary-button" type="button" :disabled="saving" @click="emit('close')">{{ label('close') }}</button><button class="primary-button" :disabled="loading||saving||blocked||saved||!ready()||(readback&&!checked)">{{ saving?label('saving'):label('save') }}</button></footer>
  </form>
 </AppModal>
</template>
<style scoped>
.officer-edit-form { display:grid; gap:16px; }
label { display:grid; gap:6px; font-size:14px; }
input,textarea { font:inherit; padding:10px; border:1px solid #b9cbc0; border-radius:8px; max-width:100%; box-sizing:border-box; }
.restriction { background:#f1f6ee; color:#53695e; padding:12px; border-radius:8px; }
.edit-error,.field-error { color:#a13f35; }
.edit-success { color:#245443; }
article { border-bottom:1px solid #dfe7df; overflow-wrap:anywhere; }
footer { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:12px; }
button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible { outline:3px solid #245443; outline-offset:3px; }
</style>
