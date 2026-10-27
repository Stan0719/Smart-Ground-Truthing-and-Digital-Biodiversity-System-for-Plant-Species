import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { createAuth } from './auth.mjs'
import { loadServerEnvironment } from './postgres.mjs'
import { emailSettings } from './activation-configuration.mjs'
import { temporaryPasswordDelivery } from './activation.mjs'
import { websiteOrigin } from './website-origin.mjs'

// Explicit owner-run bootstrap only. No public HTTP endpoint grants this role.
export async function createEmailAdministrator({ auth, deliver, email, name, origin }) {
  if (!deliver) throw Error('Email delivery must be configured before creating an administrator.')
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof name !== 'string' || !name.trim() || name.length > 100)
    throw Error('Provide a valid administrator name and email.')
  const temporaryPassword='Niah-'+randomBytes(24).toString('base64url')+'9!'
  const user=await auth.db.transaction(async()=>{
    await auth.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('initial-administrator-bootstrap')
    const existing=await auth.db.prepare("SELECT 1 FROM users WHERE role='Administrator' LIMIT 1").get()
    if(existing)throw Error('An Administrator already exists. Use its authorized recovery workflow; no account was changed.')
    if(await auth.byEmail(email.trim().toLowerCase()))throw Error('This email already belongs to an account; no role or password was changed.')
    const created=await auth.createUser({name:name.trim(),email:email.trim().toLowerCase(),role:'Administrator',password:temporaryPassword,mustChangePassword:true})
    await auth.event(created.id,'local-bootstrap','administrator_bootstrap_created')
    return created
  })
  try{
    await deliver({email:user.email,name:user.name,role:user.role,temporaryPassword,loginUrl:new URL('/',origin).href})
    await auth.event(user.id,'local-bootstrap','administrator_bootstrap_email_sent')
    return {user,delivery:'sent'}
  }catch{
    await auth.event(user.id,'local-bootstrap','administrator_bootstrap_email_failed')
    return {user,delivery:'failed',message:'Administrator created with mandatory first password change; delivery failed. No automatic retry or account reset was performed.'}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  loadServerEnvironment()
  const cli=createInterface({input:process.stdin,output:process.stdout})
  let auth
  try{
    const email=await cli.question('Admin email: '),name=await cli.question('Admin name: ')
    auth=await createAuth()
    if(process.argv.includes('--email')){
      const result=await createEmailAdministrator({auth,email,name,origin:websiteOrigin(),deliver:temporaryPasswordDelivery(emailSettings(process.env))})
      console.log('Administrator account created; delivery: '+result.delivery+'. Temporary password is never printed in email mode.')
    }else{
      const password=randomBytes(24).toString('base64url')
      const existing=await auth.db.prepare("SELECT 1 FROM users WHERE role='Administrator' LIMIT 1").get()
      if(existing)throw Error('An Administrator already exists; no account was changed.')
      await auth.createUser({name,email,role:'Administrator',password,mustChangePassword:true})
      console.log('Temporary password (save privately):',password)
    }
  }finally{await auth?.db.close();cli.close()}
}
