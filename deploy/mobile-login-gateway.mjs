// Dependency-free Windows-compatible equivalent of private-phone.Caddyfile.
// Start: node deploy/mobile-login-gateway.mjs
import {createServer, request} from 'node:http'
import {pathToFileURL} from 'node:url'
const hopHeaders = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'])
function headersWithoutHop(headers) {
 const blocked=new Set([...hopHeaders,...String(headers.connection||'').toLowerCase().split(',').map(v=>v.trim())])
 return Object.fromEntries(Object.entries(headers).filter(([name])=>!blocked.has(name.toLowerCase())))
}
export function gatewayRoute(raw, {authPort=3001,plantPort=3000,facePort=8000}={}) {
 if(!raw?.startsWith('/')||raw.startsWith('//'))return null
 let url,path
 try{url=new URL(raw,'http://localhost');path=decodeURIComponent(url.pathname)}catch{return null}
 if(/(?:^|\/)\.|^\/(?:internal|data)(?:\/|$)|^\/face\/internal(?:\/|$)|^\/auth\.sqlite(?:\/|$)/i.test(path))return null
 if(path==='/auth-health')return {port:authPort,path:'/health'}
 if(path==='/health')return {port:plantPort,path:'/health'}
 if(/^\/api\/(?:auth|admin|mobile)\//.test(path))return {port:authPort,path:url.pathname+url.search}
 if(path.startsWith('/face/'))return {port:facePort,path:url.pathname.slice(5)+url.search}
 if(path.startsWith('/api/'))return {port:plantPort,path:url.pathname+url.search}
 return null
}
export function createMobileLoginGateway(ports={}) {
 return createServer((req,res)=>{
  const send=(status,error)=>{if(res.headersSent){res.destroy();return}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error}))}
  const route=gatewayRoute(req.url,ports)
  if(!route)return send(404,'Not found.')
  const headers=headersWithoutHop(req.headers)
  // Never trust caller-supplied proxy identity or forward hop-by-hop headers.
  for(const name of Object.keys(headers))if(name==='forwarded'||name.startsWith('x-forwarded-'))delete headers[name]
  headers.host=`127.0.0.1:${route.port}`
  const upstream=request({hostname:'127.0.0.1',port:route.port,path:route.path,method:req.method,headers},response=>{
   if(response.statusCode>=300&&response.statusCode<400){response.resume();return send(502,'Upstream redirect rejected.')}
   if(res.destroyed){response.destroy();return}
   res.writeHead(response.statusCode,headersWithoutHop(response.headers));response.pipe(res)
   response.on('error',()=>res.destroy())
  })
  upstream.setTimeout(route.port===(ports.facePort||8000)?120000:15000,()=>upstream.destroy())
  upstream.on('error',()=>send(503,'Service unavailable. Please try again.'))
  let size=0
  req.on('data',chunk=>{size+=chunk.length;if(size>6*1024*1024){send(413,'Request too large.');upstream.destroy()}})
  req.on('aborted',()=>upstream.destroy())
  res.on('close',()=>{if(!res.writableFinished)upstream.destroy()})
  req.pipe(upstream)
 })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const server=createMobileLoginGateway()
 server.on('error',error=>{console.error('Mobile gateway startup failed:',error.code||error.name);process.exitCode=1})
 server.listen(8080,'127.0.0.1',()=>console.log('Mobile gateway listening on http://127.0.0.1:8080'))
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close())
}
