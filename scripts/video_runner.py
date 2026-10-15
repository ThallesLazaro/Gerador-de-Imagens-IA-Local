import argparse, os, sys
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--model',required=True);p.add_argument('--prompt',required=True);p.add_argument('--output',required=True)
p.add_argument('--width',type=int,default=640);p.add_argument('--height',type=int,default=384);p.add_argument('--duration',type=float,default=6);p.add_argument('--fps',type=int,default=24);p.add_argument('--seed',type=int,default=1);p.add_argument('--image')
a=p.parse_args()

print('Carregando bibliotecas do motor de vídeo...',flush=True)
import torch
from PIL import Image
from diffusers.utils import export_to_video

# LTX trabalha melhor com contagem 8n+1.
requested=max(9,int(round(a.duration*a.fps)))
num_frames=max(9,((requested-1)//8)*8+1)
if num_frames<requested: num_frames+=8

device='cpu'
if torch.cuda.is_available(): device='cuda'
elif hasattr(torch,'xpu') and torch.xpu.is_available(): device='xpu'

dtype=torch.float32
if device in ('cuda','xpu'):
    dtype=torch.bfloat16

print(f'Dispositivo: {device} | frames: {num_frames} | {a.width}x{a.height}',flush=True)

pipe=None
if a.image:
    try:
        from diffusers import LTXImageToVideoPipeline
        cls=LTXImageToVideoPipeline
    except Exception:
        from diffusers import LTXPipeline as cls
else:
    try:
        from diffusers import LTXPipeline
        cls=LTXPipeline
    except Exception:
        from diffusers import LTXVideoPipeline as cls

print('Carregando LTX-Video...',flush=True)
pipe=cls.from_pretrained(a.model,torch_dtype=dtype,local_files_only=True)
if device=='cuda':
    try: pipe.enable_model_cpu_offload()
    except Exception: pipe.to(device)
elif device=='xpu':
    pipe.to(device)
else:
    pipe.to('cpu')

gen=torch.Generator(device='cpu').manual_seed(a.seed)
kwargs=dict(prompt=a.prompt,width=a.width,height=a.height,num_frames=num_frames,generator=gen,num_inference_steps=28)
if a.image:
    img=Image.open(a.image).convert('RGB')
    img.thumbnail((a.width,a.height),Image.Resampling.LANCZOS)
    kwargs['image']=img

print('Gerando frames por IA...',flush=True)
out=pipe(**kwargs)
frames=getattr(out,'frames',None)
if frames is None: raise RuntimeError('Pipeline LTX não retornou frames.')
if isinstance(frames,list) and frames and isinstance(frames[0],list): frames=frames[0]
Path(a.output).parent.mkdir(parents=True,exist_ok=True)
print('Codificando MP4...',flush=True)
export_to_video(frames,a.output,fps=a.fps)
print(f'Concluído: {a.output}',flush=True)
