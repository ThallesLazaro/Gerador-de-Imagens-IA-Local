(async()=>{
  try{
    const response=await fetch('projeto.json',{cache:'no-store'});
    if(!response.ok)return;
    const project=await response.json();
    document.querySelectorAll('[data-project-link="github"]').forEach(a=>{if(project.github)a.href=project.github});
    document.querySelectorAll('[data-project-link="tutorial"]').forEach(a=>{if(project.tutorial?.url)a.href=project.tutorial.url;a.target='_blank';a.rel='noopener'});
    document.querySelectorAll('[data-project-link="developer"]').forEach(a=>{if(project.desenvolvedor?.site)a.href=project.desenvolvedor.site;a.target='_blank';a.rel='noopener'});
    const thumb=document.querySelector('.video-card img');
    if(thumb&&project.tutorial?.thumbnail)thumb.src=project.tutorial.thumbnail;
  }catch{}
})();
