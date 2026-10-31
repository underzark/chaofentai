export const imageModels=Object.freeze({'gpt-image-2.5-sunburst':{label:'高级 · Sunburst',purpose:'编辑精度优先',verified_example:'1672×941 → 3344×1888 high / Astra'},'gpt-image-2.5-flare':{label:'快速 · Flare',purpose:'快速日常生成',verified_example:null}});
export const coordinatorModels=Object.freeze({'gpt-6-astra':{label:'Astra · 已有成功样例',input:10,cached:1,output:50},'gpt-6.1-sol':{label:'Sol · 组合待验证',input:2,cached:.1,output:10},'gpt-6.1-terra':{label:'Terra · 组合待验证',input:1,cached:.05,output:5},'gpt-6-luna':{label:'Luna · 组合待验证',input:.1,cached:.01,output:.5}});
export function legacySizePlan(width,height,scale=2,image_model='gpt-image-2.5-sunburst',main_model='gpt-6-astra'){
 const error=message=>{throw Object.assign(Error(message),{status:400})};
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>20000000)error('原图尺寸无效：单边最多8192，总像素最多2000万');
 if(typeof scale!=='number'||!Number.isFinite(scale)||scale<1||scale>3840)error('倍率无效');
 if(!imageModels[image_model])error('不支持的图像模型');if(!coordinatorModels[main_model])error('不支持的主协调模型');
 if(width/height>3||height/width>3)error('暂不支持这张图的宽高比例');
 const final_width=Math.round(width*scale),final_height=Math.round(height*scale);
 let generation_width=Math.ceil(final_width/16)*16,generation_height=Math.ceil(final_height/16)*16;
 if(generation_width>3*generation_height)generation_height=Math.ceil(generation_width/3/16)*16;
 if(generation_height>3*generation_width)generation_width=Math.ceil(generation_height/3/16)*16;
 const pixels=generation_width*generation_height;
 if(generation_width>3840||generation_height>3840||pixels>8294400)error('所选倍率超出模型限制：单边3840、总像素8294400；请降低倍率，不会自动缩小');
 if(pixels<655360)error('目标低于模型最小655360像素；请提高倍率，不会自动放大');
 const extraX=generation_width-final_width,extraY=generation_height-final_height;
 return {version:1,input_width:width,input_height:height,scale,image_model,main_model,quality:'high',generation_width,generation_height,final_width,final_height,size:generation_width+'x'+generation_height,final_size:final_width+'x'+final_height,crop:{left:Math.floor(extraX/2),right:Math.ceil(extraX/2),top:Math.floor(extraY/2),bottom:Math.ceil(extraY/2)},experimental_size:pixels>2560*1440,verification:main_model==='gpt-6-astra'&&image_model==='gpt-image-2.5-sunburst'&&width===1672&&height===941&&scale===2?'same_parameters_as_successful_trial':'combination_not_live_verified',adjustment:extraX||extraY?'生成尺寸向上对齐16像素，再居中裁边；不插值缩放':'无需裁边',pricing_note:'按实际token计费，主模型另计；Flare与Sunburst当前token费率相同，快速不保证更便宜。'};
}

export function sizePlan(width,height,scale=2,image_model='gpt-image-2.5-sunburst',main_model='gpt-6.1-terra'){
 const p=legacySizePlan(width,height,scale,image_model,main_model);return {...p,version:2,output_mode:'original',final_width:p.generation_width,final_height:p.generation_height,final_size:p.size,crop:{left:0,right:0,top:0,bottom:0},adjustment:'',verification:'combination_not_live_verified'};
}
export function scaleBounds(width,height,image_model='gpt-image-2.5-sunburst'){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>20000000)throw Object.assign(Error('原图尺寸不支持'),{status:400});
 if(!imageModels[image_model])throw Object.assign(Error('图像模型不支持'),{status:400});
 if(width/height>3||height/width>3)throw Object.assign(Error('暂不支持这张图的宽高比例'),{status:400});
 const dims=s=>{let w=Math.ceil(Math.round(width*s)/16)*16,h=Math.ceil(Math.round(height*s)/16)*16;if(w>h*3)h=Math.ceil(w/3/16)*16;if(h>w*3)w=Math.ceil(h/3/16)*16;return [w,h]};
 let lo=1,hi=Math.max(1,3840/Math.max(width,height)+.01);for(let i=0;i<48;i++){const m=(lo+hi)/2,[w,h]=dims(m);if(w<=3840&&h<=3840&&w*h<=8294400)lo=m;else hi=m}const max=Math.floor(lo*100)/100;
 lo=1;hi=max;for(let i=0;i<48;i++){const m=(lo+hi)/2,[w,h]=dims(m);if(w*h>=655360)hi=m;else lo=m}const min=dims(1)[0]*dims(1)[1]>=655360?1:Math.ceil((hi-1e-10)*100)/100;
 try{sizePlan(width,height,min,image_model);sizePlan(width,height,max,image_model)}catch{throw Object.assign(Error('这张图没有可用的放大倍率'),{status:400})}
 if(min>max)throw Object.assign(Error('这张图没有可用的放大倍率'),{status:400});return {min,max,step:.01,default:Math.min(max,Math.max(min,2))};
}
