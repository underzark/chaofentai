from PIL import Image
from pathlib import Path
import random
p=Path(__file__).resolve().parent/'fixtures';p.mkdir(exist_ok=True)
for progressive in [False,True]:
 im=Image.frombytes('RGB',(1672,941),random.Random(28).randbytes(1672*941*3));e=Image.Exif();e[274]=6
 im.save(p/('progressive-rotated.jpg' if progressive else 'baseline-rotated.jpg'),quality=85,progressive=progressive,exif=e)
im=Image.new('RGB',(2000,1000),(12,30,50));e=Image.Exif();e[274]=6;im.save(p/'2mp-rotated.jpg',quality=85,exif=e)

for name,size,progressive in [('boundary-original-size-v27.jpg',(1672,941),False),('boundary-2mp-v27.jpg',(1600,1200),False),('boundary-progressive-v27.jpg',(2000,2000),True)]:
 im=Image.frombytes('RGB',size,random.Random(27).randbytes(size[0]*size[1]*3));e=Image.Exif();e[274]=6
 im.save(p/name,quality=85,progressive=progressive,exif=e)
