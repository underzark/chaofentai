import {decodeJPEG} from './jpeg-decoder.mjs';
import {pngInfo,validatePNG,pngChunk} from './png-crop.mjs';
const jpegLimit=20000000;
export function jpegInfo(b){
 if(b.length<4)throw Error('JPEG_TOO_SHORT: fewer than 4 bytes');if(b.length>8*1024*1024)throw Error('JPEG_TOO_LARGE: maximum 8 MiB');if(b[0]!==255||b[1]!==216)throw Error('JPEG_START_SIGNATURE_INVALID');
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);let p=2,width=0,height=0,orientation=1,hasExif=false,icc=false,scan=false,frame=0,scans=0,entropyBytes=0,eoiEnd=0;const components=new Map(),qt=new Set(),ht=new Set();
 while(p<b.length){if(b[p++]!==255)throw Error('Invalid JPEG marker');while(b[p]===255)p++;const mark=b[p++];if(mark===217){if(!scan||!entropyBytes)throw Error('JPEG end marker before scan');eoiEnd=p;break;}if(mark===0||mark===216||mark>=208&&mark<=215)throw Error('Unexpected JPEG marker');if(p+2>b.length)throw Error('Truncated JPEG');const n=v.getUint16(p),end=p+n;if(n<2||end>b.length)throw Error('Truncated JPEG segment');
  if(scan&&(mark===225||mark===226))throw Error('JPEG metadata after scan is unsupported; export an upright PNG first');
  if([192,193,194].includes(mark)){if(width||n<8||b[p+2]!==8||![1,3].includes(b[p+7]))throw Error('Only 8-bit grayscale/RGB JPEG supported');height=v.getUint16(p+3);width=v.getUint16(p+5);if(!width||!height||width>8192||height>8192||width*height>jpegLimit)throw Error('JPEG maximum is 20 megapixels and 8192 pixels per side');frame=mark;if(n!==8+3*b[p+7])throw Error('Invalid JPEG frame length');for(let i=0;i<b[p+7];i++){const k=p+8+i*3,id=b[k],sampling=b[k+1],table=b[k+2];if(components.has(id)||!(sampling>>4)||!(sampling&15)||(sampling>>4)>4||(sampling&15)>4||table>3)throw Error('Invalid JPEG component');components.set(id,table);}}
  if(mark===226&&new TextDecoder().decode(b.subarray(p+2,p+14))==='ICC_PROFILE\0')icc=true;
  if(mark===225&&new TextDecoder().decode(b.subarray(p+2,p+8))==='Exif\0\0'){
   if(hasExif)throw Error('Duplicate EXIF');hasExif=true;const t=p+8;if(t+8>end)throw Error('Truncated EXIF');const little=b[t]===73&&b[t+1]===73;if(!little&&!(b[t]===77&&b[t+1]===77))throw Error('Invalid EXIF byte order');const u16=o=>{if(o<t||o+2>end)throw Error('Invalid EXIF offset');return v.getUint16(o,little)},u32=o=>{if(o<t||o+4>end)throw Error('Invalid EXIF offset');return v.getUint32(o,little)};if(u16(t+2)!==42)throw Error('Invalid EXIF TIFF');const q=t+u32(t+4),count=u16(q);if(count>128||q+2+count*12+4>end)throw Error('Invalid EXIF directory');let found=false;for(let i=0;i<count;i++){const e=q+2+i*12;if(u16(e)===274){if(found||u16(e+2)!==3||u32(e+4)!==1)throw Error('Invalid EXIF orientation');found=true;orientation=u16(e+8);if(orientation<1||orientation>8)throw Error('Invalid EXIF orientation');}}
  }
  if(mark===219){let k=p+2;while(k<end){const spec=b[k++],precision=spec>>4,id=spec&15;if(precision>1||id>3||k+64*(precision+1)>end)throw Error('Invalid JPEG quantization table');qt.add(id);k+=64*(precision+1);}if(k!==end)throw Error('Invalid JPEG quantization length');}
  if(mark===196){let k=p+2;while(k<end){const spec=b[k++];if((spec>>4)>1||(spec&15)>3||k+16>end)throw Error('Invalid JPEG Huffman table');let count=0,space=1;for(let i=0;i<16;i++){space=space*2-b[k+i];count+=b[k+i];if(space<0)throw Error('Oversubscribed JPEG Huffman table');}k+=16;if(!count||count>256||k+count>end)throw Error('Invalid JPEG Huffman symbols');ht.add(spec);k+=count;}if(k!==end)throw Error('Invalid JPEG Huffman length');}
  if(mark===221&&n!==4)throw Error('Invalid JPEG restart interval');
  if(mark===218){scans++;const count=b[p+2];if(!width||!count||count>components.size||n!==6+2*count)throw Error('Invalid JPEG scan header');const seen=new Set();for(let i=0;i<count;i++){const id=b[p+3+i*2],tables=b[p+4+i*2];if(seen.has(id)||!components.has(id)||(tables>>4)>3||(tables&15)>3)throw Error('Invalid JPEG scan component');seen.add(id);if(width*height>2000000&&(!qt.has(components.get(id))||!ht.has(tables>>4)||!ht.has(16+(tables&15))))throw Error('Missing JPEG coding table');}if(width*height>2000000&&(frame!==192||scans!==1||count!==components.size||b[end-3]!==0||b[end-2]!==63||b[end-1]!==0))throw Error('Large JPEG requires upright baseline single scan; export PNG');}
  if(mark>=192&&mark<=207&&![192,193,194,196].includes(mark))throw Error('Unsupported JPEG coding marker');
  p=end;
  if(mark===218){
   scan=true;
   // Walk entropy bytes, not byte-substring searching: FF00 is data, RSTn stays in scan.
   let boundary=false;
   while(p<b.length){
    if(b[p++]!==255){entropyBytes++;continue;}
    const markerStart=p-1;while(p<b.length&&b[p]===255)p++;
    if(p>=b.length)throw Error('Truncated JPEG entropy');
    const next=b[p++];if(next===0||(next>=208&&next<=215))continue;
    p=markerStart;boundary=true;break;
   }
   if(!boundary)throw Error('Truncated JPEG scan');
  }
 }
 if(!eoiEnd)throw Error('JPEG_EOI_MISSING: complete end marker required');
 const trailer=b.subarray(eoiEnd);if(trailer.length){
  // Tiny opaque binary trailer only; do not accept concatenated media, metadata or executable/text payload.
  if(trailer.length>32)throw Error('JPEG_TRAILER_UNSUPPORTED: maximum 32 trailing bytes');
  const signatures=[[255,216],[255,225],[255,226],[137,80,78,71],[71,73,70,56],[80,75,3,4],[80,75,5,6],[80,75,7,8],[37,80,68,70],[77,90],[127,69,76,70],[82,73,70,70]];
  for(const signature of signatures)for(let i=0;i+signature.length<=trailer.length;i++)if(signature.every((v,k)=>trailer[i+k]===v))throw Error('JPEG_TRAILER_PAYLOAD_REJECTED');
  let printable=0;for(const byte of trailer){printable=byte>=32&&byte<=126?printable+1:0;if(printable>=8)throw Error('JPEG_TRAILER_TEXT_REJECTED');}
 }
 if(!width||!scan||!entropyBytes)throw Error('JPEG frame or scan missing');if(icc&&orientation!==1)throw Error('JPEG with both ICC profile and EXIF rotation: export an upright PNG first');
 if(width*height>2000000&&(orientation!==1||frame!==192||scans!==1))throw Error('Rotated or progressive JPEG maximum is 2 megapixels; export an upright PNG');
 return {eoi_end:eoiEnd,trailer_bytes:trailer.length,direct:width*height>2000000,width:orientation>=5?height:width,height:orientation>=5?width:height,rawWidth:width,rawHeight:height,orientation,mime:'image/jpeg'};
}
export function inputInfo(b){return b[0]===255&&b[1]===216?jpegInfo(b):{...pngInfo(b),mime:'image/png'};}
async function orientedPNG(decoded,info){
 const {width:w,height:h,orientation:o}=info,sw=decoded.width,sh=decoded.height;
 const rows=new ReadableStream({start(){this.y=0},pull(controller){if(this.y>=h){controller.close();return;}const y=this.y++,row=new Uint8Array(w*3+1);for(let x=0;x<w;x++){let sx=x,sy=y;switch(o){case 2:sx=sw-1-x;break;case 3:sx=sw-1-x;sy=sh-1-y;break;case 4:sy=sh-1-y;break;case 5:sx=y;sy=x;break;case 6:sx=y;sy=sh-1-x;break;case 7:sx=sw-1-y;sy=sh-1-x;break;case 8:sx=sw-1-y;sy=x;break;}const off=(sy*sw+sx)*3;row.set(decoded.data.subarray(off,off+3),1+x*3);}controller.enqueue(row);}});
 const reader=rows.pipeThrough(new CompressionStream('deflate')).getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024-128)throw Error('Upright PNG exceeds 8 MiB');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
 const ihdr=new Uint8Array(13),d=new DataView(ihdr.buffer);d.setUint32(0,w);d.setUint32(4,h);ihdr[8]=8;ihdr[9]=2;const total=8+25+size+chunks.length*12+12;if(total>8*1024*1024)throw Error('Upright PNG exceeds 8 MiB');const out=new Uint8Array(total);out.set([137,80,78,71,13,10,26,10]);let offset=8;for(const chunk of [pngChunk('IHDR',ihdr)]){out.set(chunk,offset);offset+=chunk.length;}for(const part of chunks){const chunk=pngChunk('IDAT',part);out.set(chunk,offset);offset+=chunk.length;}out.set(pngChunk('IEND',new Uint8Array()),offset);return out;
}
export async function validateInput(b){
 if(b[0]!==255||b[1]!==216)return {...await validatePNG(b),mime:'image/png',normalized:null};
 const info=jpegInfo(b),canonical=info.trailer_bytes?b.slice(0,info.eoi_end):b;if(info.direct)return {...info,normalized:info.trailer_bytes?canonical:null,normalized_mime:'image/jpeg',validation:'bounded-baseline-structure'};const decoded=decodeJPEG(canonical,{useTArray:true,formatAsRGBA:false,tolerantDecoding:false,maxResolutionInMP:2,maxMemoryUsageInMB:24});
 if(decoded.width!==info.rawWidth||decoded.height!==info.rawHeight)throw Error('JPEG dimension mismatch');
 return {...info,normalized:info.orientation===1?(info.trailer_bytes?canonical:null):await orientedPNG(decoded,info),normalized_mime:info.orientation===1?'image/jpeg':'image/png'};
}
