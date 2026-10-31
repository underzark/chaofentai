const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
function pngCRC(bytes){let c=0xffffffff;for(const v of bytes){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
export function pngChunk(type,data){const b=new Uint8Array(data.length+12),d=new DataView(b.buffer);d.setUint32(0,data.length);b.set(new TextEncoder().encode(type),4);b.set(data,8);d.setUint32(b.length-4,pngCRC(b.subarray(4,b.length-4)));return b}
export function pngInfo(bytes){if(bytes.length<33||!signature.every((v,i)=>bytes[i]===v))throw Error('Invalid PNG');const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return {width:d.getUint32(16),height:d.getUint32(20),depth:bytes[24],color:bytes[25],interlace:bytes[28]}}
export async function cropPNG(bytes,top=3,bottom=3,left=0,right=0){
 const info=pngInfo(bytes);if(info.width>3840||info.height>3840||info.width*info.height>8294400||![top,bottom,left,right].every(n=>Number.isInteger(n)&&n>=0)||top+bottom>=info.height||left+right>=info.width)throw Error('Invalid crop or PNG dimensions');
 if(info.depth!==8||![2,6].includes(info.color)||info.interlace!==0)throw Error('Unsupported PNG pixel format; original retained');
 const channels=info.color===6?4:3,stride=info.width*channels,parts=[],metadata=[];let ihdr;const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let ended=false;
 for(let p=8;p<bytes.length;){if(p+12>bytes.length)throw Error('Truncated PNG');const n=d.getUint32(p),end=p+12+n;if(end>bytes.length)throw Error('Truncated PNG chunk');const type=String.fromCharCode(...bytes.subarray(p+4,p+8));if(pngCRC(bytes.subarray(p+4,p+8+n))!==d.getUint32(p+8+n))throw Error('PNG CRC mismatch');const data=bytes.subarray(p+8,p+8+n);if(type==='IHDR')ihdr=new Uint8Array(data);else if(type==='IDAT')parts.push(data);else if(type==='IEND'){ended=true;break}else if(['sRGB','gAMA','cHRM','iCCP','pHYs'].includes(type))metadata.push(bytes.subarray(p,end));p=end;}
 if(!ended||!ihdr||!parts.length)throw Error('Incomplete PNG');
 const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 const compressor=new CompressionStream('deflate'),writer=compressor.writable.getWriter();
 const compressedPromise=new Response(compressor.readable).arrayBuffer();
 let previous=new Uint8Array(stride),row=new Uint8Array(stride+1),filled=0,y=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;for(let p=0;p<value.length;){const n=Math.min(row.length-filled,value.length-p);row.set(value.subarray(p,p+n),filled);filled+=n;p+=n;if(filled!==row.length)continue;if(y>=info.height)throw Error('PNG decompression exceeds expected size');const filter=row[0];if(filter>4)throw Error('Invalid PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?row[1+x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;let predictor=0;if(filter===1)predictor=a;if(filter===2)predictor=b;if(filter===3)predictor=Math.floor((a+b)/2);if(filter===4){const z=a+b-c,pa=Math.abs(z-a),pb=Math.abs(z-b),pc=Math.abs(z-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c}row[1+x]=(row[1+x]+predictor)&255;}previous.set(row.subarray(1));if(y>=top&&y<info.height-bottom){row[0]=0;const trimmed=new Uint8Array(1+(info.width-left-right)*channels);trimmed.set(row.subarray(1+left*channels,1+(info.width-right)*channels),1);await writer.write(trimmed)}y++;filled=0;}}
 if(y!==info.height||filled)throw Error('PNG decoded length mismatch');await writer.close();
 }catch(e){await reader.cancel().catch(()=>{});await writer.abort(e).catch(()=>{});await compressedPromise.catch(()=>{});throw e;}
 new DataView(ihdr.buffer,ihdr.byteOffset,ihdr.byteLength).setUint32(0,info.width-left-right);new DataView(ihdr.buffer,ihdr.byteOffset,ihdr.byteLength).setUint32(4,info.height-top-bottom);
 const compressed=new Uint8Array(await compressedPromise);return new Uint8Array(await new Blob([signature,pngChunk('IHDR',ihdr),...metadata,pngChunk('IDAT',compressed),pngChunk('IEND',new Uint8Array())]).arrayBuffer());
}

// Validates original bytes without re-encoding. Inflate is streamed and size-bounded.
export async function validatePNG(bytes,{maxWidth=8192,maxHeight=8192,maxPixels=20000000}={}){
 const info=pngInfo(bytes),{width:w,height:h,depth,color,interlace}=info;
 const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]},channels={0:1,2:3,3:1,4:2,6:4}[color];
 if(!w||!h||w>maxWidth||h>maxHeight||w*h>maxPixels||!depths[color]?.includes(depth)||![0,1].includes(interlace)||bytes[26]!==0||bytes[27]!==0)throw Error('Unsupported PNG dimensions or format');
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts=[];let header=false,palette=false,idat=false,idatClosed=false,ended=false;
 for(let p=8;p<bytes.length;){if(p+12>bytes.length)throw Error('Truncated PNG');const n=d.getUint32(p),end=p+n+12;if(end>bytes.length)throw Error('Truncated PNG chunk');const type=String.fromCharCode(...bytes.subarray(p+4,p+8));if(!/^[A-Za-z]{4}$/.test(type)||pngCRC(bytes.subarray(p+4,p+8+n))!==d.getUint32(p+8+n))throw Error('PNG CRC mismatch');
  if(!header&&type!=='IHDR')throw Error('PNG header missing');
  if(type==='IHDR'){if(header||p!==8||n!==13)throw Error('Invalid PNG header');header=true;}
  else if(type==='PLTE'){if(palette||idat||n===0||n%3||n>768)throw Error('Invalid palette');palette=true;}
  else if(type==='IDAT'){if(idatClosed||(color===3&&!palette))throw Error('Invalid PNG data order');idat=true;parts.push(bytes.subarray(p+8,p+8+n));}
  else if(type==='IEND'){if(n||!idat||end!==bytes.length)throw Error('Invalid PNG end');ended=true;break;}
  else {if(idat)idatClosed=true;if(type[0]===type[0].toUpperCase())throw Error('Unknown critical PNG chunk');if(['acTL','fcTL','fdAT'].includes(type))throw Error('Animated PNG not supported');}
  p=end;
 }
 if(!ended)throw Error('Incomplete PNG');
 const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
 const rows=[];let expected=0;for(const [x,y,dx,dy] of passes){const pw=Math.max(0,Math.ceil((w-x)/dx)),ph=Math.max(0,Math.ceil((h-y)/dy));if(!pw||!ph)continue;const stride=1+Math.ceil(pw*channels*depth/8);rows.push({count:ph,stride});expected+=ph*stride;}
 const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let total=0,pass=0,row=0,pos=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>expected)throw Error('PNG decoded size exceeds dimensions');for(let i=0;i<value.length;){if(pos===0&&value[i]>4)throw Error('Invalid PNG filter');const n=Math.min(value.length-i,rows[pass].stride-pos);i+=n;pos+=n;if(pos===rows[pass].stride){pos=0;if(++row===rows[pass].count){row=0;pass++;}}}}if(total!==expected||pos)throw Error('PNG decoded size mismatch');}catch(e){await reader.cancel().catch(()=>{});throw e;}
 return info;
}

export async function thumbnailPNG(bytes){
 const top=0,bottom=0,left=0,right=0;
 const info=pngInfo(bytes);if(info.width>3840||info.height>3840||info.width*info.height>8294400||![top,bottom,left,right].every(n=>Number.isInteger(n)&&n>=0)||top+bottom>=info.height||left+right>=info.width)throw Error('Invalid crop or PNG dimensions');
 if(info.depth!==8||![2,6].includes(info.color)||info.interlace!==0)throw Error('Unsupported PNG pixel format; original retained');
 const tw=Math.max(1,Math.round(info.width*Math.min(1,192/Math.max(info.width,info.height)))),th=Math.max(1,Math.round(info.height*Math.min(1,192/Math.max(info.width,info.height))));let ty=0;
 const channels=info.color===6?4:3,stride=info.width*channels,parts=[],metadata=[];let ihdr;const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let ended=false;
 for(let p=8;p<bytes.length;){if(p+12>bytes.length)throw Error('Truncated PNG');const n=d.getUint32(p),end=p+12+n;if(end>bytes.length)throw Error('Truncated PNG chunk');const type=String.fromCharCode(...bytes.subarray(p+4,p+8));if(pngCRC(bytes.subarray(p+4,p+8+n))!==d.getUint32(p+8+n))throw Error('PNG CRC mismatch');const data=bytes.subarray(p+8,p+8+n);if(type==='IHDR')ihdr=new Uint8Array(data);else if(type==='IDAT')parts.push(data);else if(type==='IEND'){ended=true;break}else if(['sRGB','gAMA','cHRM','iCCP','pHYs'].includes(type))metadata.push(bytes.subarray(p,end));p=end;}
 if(!ended||!ihdr||!parts.length)throw Error('Incomplete PNG');
 const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 const compressor=new CompressionStream('deflate'),writer=compressor.writable.getWriter();
 const compressedPromise=new Response(compressor.readable).arrayBuffer();
 let previous=new Uint8Array(stride),row=new Uint8Array(stride+1),filled=0,y=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;for(let p=0;p<value.length;){const n=Math.min(row.length-filled,value.length-p);row.set(value.subarray(p,p+n),filled);filled+=n;p+=n;if(filled!==row.length)continue;if(y>=info.height)throw Error('PNG decompression exceeds expected size');const filter=row[0];if(filter>4)throw Error('Invalid PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?row[1+x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;let predictor=0;if(filter===1)predictor=a;if(filter===2)predictor=b;if(filter===3)predictor=Math.floor((a+b)/2);if(filter===4){const z=a+b-c,pa=Math.abs(z-a),pb=Math.abs(z-b),pc=Math.abs(z-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c}row[1+x]=(row[1+x]+predictor)&255;}previous.set(row.subarray(1));if(ty<th&&y===Math.floor(ty*info.height/th)){const sampled=new Uint8Array(1+tw*channels);for(let x=0;x<tw;x++){const sx=Math.floor(x*info.width/tw);sampled.set(row.subarray(1+sx*channels,1+(sx+1)*channels),1+x*channels);}await writer.write(sampled);ty++;}y++;filled=0;}}
 if(y!==info.height||filled)throw Error('PNG decoded length mismatch');await writer.close();
 }catch(e){await reader.cancel().catch(()=>{});await writer.abort(e).catch(()=>{});await compressedPromise.catch(()=>{});throw e;}
 new DataView(ihdr.buffer,ihdr.byteOffset,ihdr.byteLength).setUint32(0,tw);new DataView(ihdr.buffer,ihdr.byteOffset,ihdr.byteLength).setUint32(4,th);
 const compressed=new Uint8Array(await compressedPromise);return new Uint8Array(await new Blob([signature,pngChunk('IHDR',ihdr),...metadata,pngChunk('IDAT',compressed),pngChunk('IEND',new Uint8Array())]).arrayBuffer());
}

