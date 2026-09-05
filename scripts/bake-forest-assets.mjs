/** Offline authored silhouettes using only the actual CC0 model's twig textures.
 * No website render is an input. Sources and checksums: textures/CREDITS.md. */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = (name) => new URL(`./data/textures/pine_tree_01_${name}_1k.png`, import.meta.url);
const expected = { twig_diff: 'a4fa4a55aab9231915a4023ea9841577', twig_alpha: '641911a5a3f543911dad04ebb26e7bca' };
for (const [name, hash] of Object.entries(expected)) {
  if (createHash('md5').update(await readFile(source(name))).digest('hex') !== hash) throw new Error(`Unexpected source: ${name}`);
}
const crop = { left: 32, top: 35, width: 190, height: 420 };
const alpha = await sharp(source('twig_alpha').pathname).extract(crop).extractChannel(0).raw().toBuffer();
// UV island crop includes unrelated padding in its lower corners. Keep only
// the largest connected alpha island (the photographed twig), never UV padding.
for(let y=300;y<crop.height;y++)for(let x=0;x<crop.width;x++){
  if(Math.abs(x-107)>(y>355?10:26))alpha[y*crop.width+x]=0;
}
const seen=new Uint8Array(alpha.length),queue=new Int32Array(alpha.length);let largest=[];
for(let start=0;start<alpha.length;start++){
  if(seen[start]||alpha[start]<8)continue;
  let head=0,tail=1;queue[0]=start;seen[start]=1;
  while(head<tail){const i=queue[head++],x=i%crop.width,y=Math.floor(i/crop.width);
    for(const n of [x>0?i-1:-1,x<crop.width-1?i+1:-1,y>0?i-crop.width:-1,y<crop.height-1?i+crop.width:-1]){
      if(n>=0&&!seen[n]&&alpha[n]>=8){seen[n]=1;queue[tail++]=n;}
    }
  }
  if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
}
const keep=new Uint8Array(alpha.length);for(const i of largest)keep[i]=1;
for(let i=0;i<alpha.length;i++)if(!keep[i])alpha[i]=0;
const rgb = await sharp(source('twig_diff').pathname).extract(crop).removeAlpha().raw().toBuffer();
const twig = await sharp(rgb,{raw:{width:crop.width,height:crop.height,channels:3}}).joinChannel(alpha, {raw:{width:crop.width,height:crop.height,channels:1}}).png().toBuffer();
const sprites = [];
for (let angle=0; angle<360; angle+=15) {
  sprites.push(await sharp(twig).resize(25,56).rotate(angle,{background:'#00000000'}).raw().toBuffer({resolveWithObject:true}));
}
const width=1024,height=1024;
const rng = (seed) => () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
const random=rng(7031), crowns=[], lines=[];
for(let tree=0;tree<3;tree++){
  const cx=170+tree*341,wide=tree===2,top=wide?135:35;
  const trunkWidth=wide?17:11;
  lines.push(`<path d="M${cx-trunkWidth/2} 1016 Q${cx-4} 650 ${cx-2} ${top} L${cx+2} ${top} Q${cx+7} 720 ${cx+trunkWidth/2} 1016Z" fill="url(#bark)"/>`);
  for(let y=top+15;y<995;y+=13){const x=cx+(random()-.5)*trunkWidth*.6;lines.push(`<path d="M${x} ${y}l-2 11" stroke="#312d25" stroke-width="1.3"/>`);}
  // Pine boughs are separated tiers, with visible woody inner branches.
  // Only distal branches carry dense needles; leaving the trunk/negative gaps
  // exposed prevents the continuous leafy column of a cypress/hedge silhouette.
  const tiers=wide?8:13;
  for(let layer=0;layer<tiers;layer++){
    const t=layer/(tiers-1),y=wide?170+t*420:75+t*650;
    const radius=wide ? 48+95*Math.sin(Math.PI*(.08+t*.86)) : 18+118*t;
    for(const side of [-1,1]){
      const reach=radius*(.8+random()*.2),tipX=cx+side*reach;
      const rise=wide?35+random()*38:8+random()*18,offset=(random()-.5)*(wide?44:16),tipY=y-rise+offset;
      lines.push(`<path d="M${cx} ${y+12}Q${cx+side*reach*.4} ${y+8} ${tipX} ${tipY}" fill="none" stroke="#625745" stroke-width="${wide?4:2.5}"/>`);
      const count=wide?8:Math.max(3,Math.ceil(reach/19));
      for(let j=0;j<count;j++){
        const along=.42+.58*(j+.3)/count;
        const bx=cx+side*reach*along,by=y-rise*along+offset*along;
        lines.push(`<path d="M${bx} ${by+4}l${side*14} -10" stroke="#73674c" stroke-width="1.3"/>`);
        for(let cluster=0;cluster<(wide?3:2);cluster++)crowns.push({x:bx+(random()-.5)*(wide?20:12),y:by+(random()-.5)*(wide?21:10),
          angle:Math.round((side*(72+random()*36)+360)/15)%24,light:.78+random()*.5});
      }
      // A few upright shoots on upper tiers, keeping the leader recognizable.
      if(layer<3)crowns.push({x:cx+side*reach*.18,y:y-17,angle:side>0?1:23,light:1.1});
    }
  }
  // Dead/exposed lower branches are common on mountain pines; sparse needles
  // at the outer end keep lower limbs readable against snow.
  for(let tier=0;tier<3;tier++)for(const side of [-1,1]){
    const y=(wide?665:810)+tier*47,reach=(wide?90:112)*(1-tier*.19),x=cx+side*reach;
    lines.push(`<path d="M${cx} ${y}Q${cx+side*reach*.6} ${y+13} ${x} ${y-7}" fill="none" stroke="#655746" stroke-width="2.6"/>`);
    if(tier===0)for(let j=0;j<3;j++)crowns.push({x:x-side*j*13,y:y-11-j*3,angle:side>0?6:18,light:.9});
  }
  for(let i=0;i<9;i++)crowns.push({x:cx+(random()-.5)*18,y:top+16+i*5,angle:Math.floor(random()*3+23)%24,light:1.05});
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="bark"><stop stop-color="#403a2f"/><stop offset=".55" stop-color="#97816a"/><stop offset="1" stop-color="#4e493a"/></linearGradient></defs>${lines.join('')}</svg>`;
const canvas=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
// Alpha-over is performed in the offline bake, never on the runtime frame path.
for(const c of crowns){
  const sprite=sprites[c.angle],sw=sprite.info.width,sh=sprite.info.height;
  const left=Math.round(c.x-sw/2),top=Math.round(c.y-sh/2);
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
    const dx=left+x,dy=top+y;if(dx<0||dx>=width||dy<0||dy>=height)continue;
    const a=(y*sw+x)*4,b=(dy*width+dx)*4,sa=sprite.data[a+3]/255;if(!sa)continue;
    const da=canvas[b+3]/255,out=sa+da*(1-sa);
    for(let channel=0;channel<3;channel++)canvas[b+channel]=Math.round((Math.min(255,sprite.data[a+channel]*c.light)*sa+canvas[b+channel]*da*(1-sa))/out);
    canvas[b+3]=Math.round(out*255);
  }
}
const output=new URL('../public/game/textures/pine-atlas.webp',import.meta.url);
await sharp(canvas,{raw:{width,height,channels:4}}).webp({quality:90,alphaQuality:100}).toFile(output.pathname);
// Retain the authored assembly description alongside the actual texture sources.
await writeFile(new URL('./data/textures/pine-atlas-assembly.svg',import.meta.url),svg);
