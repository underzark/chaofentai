import fs from 'node:fs';import assert from 'node:assert/strict';import {jpegInfo,validateInput} from '../worker/image-input.mjs';import {decodeJPEG} from '../worker/jpeg-decoder.mjs';
const b=fs.readFileSync('scripts/fixtures-v27/orientation-6.jpg');let exifStart=-1,exifEnd=-1;for(let p=2;p<b.length;){const mark=b[p+1],n=b.readUInt16BE(p+2);if(mark===225&&b.toString('ascii',p+4,p+10)==='Exif\0\0'){exifStart=p;exifEnd=p+2+n;break}if(mark===218)break;p+=2+n}assert.ok(exifStart>0);
const exif=b.subarray(exifStart,exifEnd),removed=Buffer.concat([b.subarray(0,exifStart),b.subarray(exifEnd)]);const lateExif=Buffer.concat([removed.subarray(0,-2),exif,removed.subarray(-2)]);
const decoded=decodeJPEG(lateExif,{useTArray:true,formatAsRGBA:false,tolerantDecoding:false,maxResolutionInMP:2,maxMemoryUsageInMB:24});assert.ok(decoded.exifBuffer);await assert.rejects(validateInput(lateExif),/metadata after scan/);
const payload=Buffer.concat([Buffer.from('ICC_PROFILE\0','ascii'),Buffer.from([1,1]),Buffer.alloc(128)]),icc=Buffer.alloc(payload.length+4);icc[0]=255;icc[1]=226;icc.writeUInt16BE(payload.length+2,2);payload.copy(icc,4);
const earlyICC=Buffer.concat([b.subarray(0,2),icc,b.subarray(2)]);await assert.rejects(validateInput(earlyICC),/ICC/);
const lateICC=Buffer.concat([b.subarray(0,-2),icc,b.subarray(-2)]);await assert.rejects(validateInput(lateICC),/metadata after scan/);console.log('PASS v28 late EXIF and late ICC rejected; early ICC plus rotation rejected.');

await assert.rejects(validateInput(Buffer.concat([b,exif,Buffer.from([255,217])])),/JPEG_TRAILER_/);
