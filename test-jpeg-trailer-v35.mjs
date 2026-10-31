import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {jpegInfo,validateInput} from './worker/image-input.mjs';
import {decodeJPEG} from './worker/jpeg-decoder.mjs';
const root=new URL('./scripts/fixtures-v33/baseline-1279x2014.jpg',import.meta.url);
const original=new Uint8Array(await readFile(root));
const tail=Uint8Array.from({length:24},(_,i)=>(i*71+131)%256);
const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let p=0;for(const part of parts){b.set(part,p);p+=part.length;}return b};
const segment=(marker,data)=>join(Uint8Array.of(255,marker,(data.length+2)>>8,(data.length+2)&255),data);
// Fake EOI inside ICC payload must be skipped by segment length, not found by byte search.
const icc=segment(226,join(new TextEncoder().encode('ICC_PROFILE\0'),Uint8Array.of(1,1,255,217,1,2,3,4)));
const canonical=join(original.slice(0,2),icc,original.slice(2)),input=join(canonical,tail),before=input.slice();
const validated=await validateInput(input);assert.equal(validated.width,1279);assert.equal(validated.height,2014);assert.equal(validated.eoi_end,canonical.length);assert.equal(validated.trailer_bytes,24);assert.equal(validated.normalized_mime,'image/jpeg');assert.deepEqual(validated.normalized,canonical);assert.deepEqual(input,before);assert.equal(validated.validation,'bounded-baseline-structure');
const clean=await validateInput(canonical);assert.equal(clean.normalized,null);
for(const trailer of [new Uint8Array(33),Uint8Array.of(255,216),Uint8Array.of(255,225),Uint8Array.of(255,226),new TextEncoder().encode('PK\x03\x04'),new TextEncoder().encode('<script>evil</script>'),new TextEncoder().encode('%PDF-1.0'),Uint8Array.of(137,80,78,71)])await assert.rejects(()=>validateInput(join(canonical,trailer)),/TRAILER/);
await assert.rejects(()=>validateInput(canonical.slice(0,-2)));await assert.rejects(()=>validateInput(canonical.slice(0,-50)));await assert.rejects(()=>validateInput(join(canonical,canonical)),/TRAILER/);
const lateExif=join(canonical.slice(0,-2),segment(225,new TextEncoder().encode('Exif\0\0')),canonical.slice(-2),tail);await assert.rejects(()=>validateInput(lateExif),/metadata after scan/);
const small=new Uint8Array(await readFile(new URL('./scripts/fixtures-v27/orientation-1.jpg',import.meta.url))),smallTail=join(small,tail);const result=await validateInput(smallTail);assert.deepEqual(result.normalized,small);const opts={useTArray:true,formatAsRGBA:false,tolerantDecoding:false,maxResolutionInMP:2,maxMemoryUsageInMB:24};assert.deepEqual(decodeJPEG(result.normalized,opts).data,decodeJPEG(small,opts).data);
console.log('PASS v35 structural EOI skips ICC payload, 24-byte trailer stripped without re-encoding, input identity/ICC preserved, small decoded pixels identical; absent EOI/truncated/oversized/text/second-media/late EXIF rejected.');
