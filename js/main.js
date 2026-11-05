// Shared interactions for every page.
const nav=document.querySelector('.nav'),hamb=document.querySelector('.hamb'),links=document.querySelector('.links');
window.addEventListener('scroll',()=>{nav?.classList.toggle('scrolled',scrollY>30);document.querySelector('#top')?.style.setProperty('display',scrollY>500?'block':'none')});
hamb?.addEventListener('click',()=>{links.classList.toggle('open');hamb.setAttribute('aria-expanded',links.classList.contains('open'))});
document.querySelectorAll('.links a').forEach(a=>a.addEventListener('click',()=>links?.classList.remove('open')));
const observer=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');observer.unobserve(e.target)}}),{threshold:.12});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
document.querySelectorAll('.faq-q').forEach(q=>q.addEventListener('click',()=>{const p=q.closest('.faq-item');p.classList.toggle('open');q.setAttribute('aria-expanded',p.classList.contains('open'))}));
document.querySelector('#top')?.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
document.querySelectorAll('.beforeafter input').forEach(i=>i.addEventListener('input',()=>i.parentElement.style.setProperty('--split',i.value+'%')));
let slide=0;const ts=[...document.querySelectorAll('.testimonial')];if(ts.length>1)setInterval(()=>{ts[slide].classList.remove('active');slide=(slide+1)%ts.length;ts[slide].classList.add('active')},5000);
const load=document.querySelector('.loading');if(load)window.addEventListener('load',()=>setTimeout(()=>load.classList.add('done'),1500));
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('[data-category]').forEach(el=>el.hidden=b.dataset.filter!=='all'&&el.dataset.category!==b.dataset.filter)}));
document.querySelectorAll('.gallery-grid img').forEach(img=>img.addEventListener('click',()=>{const lb=document.querySelector('.lightbox');if(lb){lb.querySelector('img').src=img.src;lb.classList.add('show')}}));document.querySelector('.lightbox button')?.addEventListener('click',()=>document.querySelector('.lightbox').classList.remove('show'));
document.querySelectorAll('[data-counter]').forEach(el=>{const end=+el.dataset.counter;let n=0;const run=()=>{n=Math.min(end,n+Math.ceil(end/35));el.textContent=n+(el.dataset.suffix||'');if(n<end)requestAnimationFrame(run)};new IntersectionObserver(([x],o)=>{if(x.isIntersecting){run();o.disconnect()}}).observe(el)});
