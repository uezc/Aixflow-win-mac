import { useEffect, useMemo, useRef, useState } from 'react';
import { getProjects } from '../data/content';
import { useSiteLocale } from '../lib/siteLocale';

function ProjectItem({
  name,
  description,
  video,
}: {
  name: string;
  description: string;
  video: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <article ref={ref} className={`${inView ? 'animate-fade-in-up' : 'opacity-0'}`}>
      <div className="ml-20 md:ml-28">
        <h3 className="font-serif text-2xl font-semibold text-zinc-100 md:text-3xl">{name}</h3>
        <p className="mt-2 text-sm text-zinc-400 md:text-base">{description}</p>
      </div>
      <div className="mt-6 aspect-video w-full overflow-hidden rounded-2xl bg-black/40 shadow-lg">
        <video
          src={video}
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
      </div>
    </article>
  );
}

export function ProjectsSection() {
  const { t } = useSiteLocale();
  const projects = useMemo(() => {
    const media = getProjects();
    return media.map((p, i) => ({
      ...p,
      name: t.projects[i]?.name ?? p.name,
      description: t.projects[i]?.description ?? p.description,
    }));
  }, [t.projects]);
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="flex flex-col gap-16 md:gap-20">
        {projects.map((project) => (
          <ProjectItem key={project.video} {...project} />
        ))}
      </div>
    </section>
  );
}
