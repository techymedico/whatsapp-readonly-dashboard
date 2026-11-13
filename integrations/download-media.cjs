// Firebase-side only; token is never passed to the Oracle dashboard.
const {validate}=require('./media.cjs');
const crypto=require('node:crypto');
async function downloadMedia(id,mime,{token,version,fetchImpl=fetch}) {
 if(!/^\d+$/.test(id)||!/^v\d+\.\d+$/.test(version))throw Error('Invalid media request');
 const options={headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)};
 const meta=await fetchImpl(`https://graph.facebook.com/${version}/${id}`,options);
 if(!meta.ok)throw Error('Media metadata unavailable');
 const info=await meta.json(),url=new URL(info.url);
 if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='lookaside.fbsbx.com'||url.hostname.endsWith('.fbcdn.net')))throw Error('Unexpected media host');
 const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(30000)});
 if(!response.ok||Number(response.headers.get('content-length'))>10000000)throw Error('Media unavailable or oversized');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10000000)throw Error('Media too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
 const bytes=Buffer.concat(chunks);validate(bytes,mime);
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 if(info.sha256&&![digest,Buffer.from(digest,'hex').toString('base64')].includes(info.sha256))throw Error('Media integrity mismatch');
 return bytes;
}
module.exports={downloadMedia};
