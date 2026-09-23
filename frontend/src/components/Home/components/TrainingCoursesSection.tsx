import React, { useState } from 'react';
import { 
  GraduationCap, PlayCircle, BookOpen, Sparkles, Filter, 
  Award, Video, Users, CheckCircle2, PhoneCall, ArrowRight, Layers 
} from 'lucide-react';
import { TRAINING_COURSES, CourseCategory, CourseItem } from '../data/coursesData';
import { CourseVideoCard } from './courses/CourseVideoCard';
import { useI18n } from '../../../i18n/I18nProvider'

interface TrainingCoursesSectionProps {
  id?: string;
  className?: string;
  onRequestCustomTraining?: () => void;
}

export const TrainingCoursesSection: React.FC<TrainingCoursesSectionProps> = ({
  id = 'cursos',
  className = '',
  onRequestCustomTraining,
}) => {
  const { t } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState<CourseCategory>('all');

  // Filter courses
  const filteredCourses = TRAINING_COURSES.filter((course) => {
    if (selectedCategory === 'all') return true;
    return course.category === selectedCategory;
  });

  const categories: { id: CourseCategory; labelKey: string }[] = [
    { id: 'all', labelKey: 'courses.filter.all' },
    { id: 'system_basics', labelKey: 'courses.filter.system_basics' },
  ];

  return (
    <section id={id} className={`py-20 bg-[#070c18] relative overflow-hidden text-slate-100 ${className}`}>
      
      {/* Subtle Background Glows */}
      <div className="absolute top-1/4 left-0 w-96 h-96 bg-[#F05A28]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 space-y-12">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[#3A3D40]/50 pb-8">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F05A28]/10 border border-[#F05A28]/30 text-[#FCD3B0] text-xs font-mono font-bold tracking-wider uppercase">
              <GraduationCap className="w-4 h-4 text-[#F05A28]" />
              <span>{t('courses.sectionBadge')}</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight font-sans">
              {t('courses.mainTitle')} <span className="text-[#F05A28]">{t('courses.titleHighlight')}</span>
            </h2>

            <p className="text-sm sm:text-base text-[#E1E4E8]/80 leading-relaxed font-sans">
              {t('courses.mainSubtitle')}
            </p>
          </div>

          {/* Quick Metrics Badge */}
          <div className="flex items-center gap-4 bg-[#0D121F] p-3.5 rounded-2xl border border-[#3A3D40] shrink-0">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
              <Video className="w-4 h-4 text-[#F05A28]" />
              <span>{TRAINING_COURSES.length} {t('courses.metrics.videosCount')}</span>
            </div>
            <span className="text-slate-600">|</span>
          </div>
        </div>

        {/* Category Filters Pills */}
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 mr-2">
            <Filter className="w-3.5 h-3.5 text-[#F05A28]" />
            <span>{t('courses.filter.label')}:</span>
          </div>

          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
                selectedCategory === cat.id
                  ? 'bg-[#F05A28] text-slate-950 shadow-md shadow-[#F05A28]/20 scale-105'
                  : 'bg-[#0D121F] border border-[#3A3D40] text-slate-300 hover:text-white hover:border-[#F05A28]/50'
              }`}
            >
              {t(cat.labelKey)}
            </button>
          ))}
        </div>

        {/* Grid of Framed Direct Video Course Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {filteredCourses.map((course) => (
            <CourseVideoCard
              key={course.id}
              course={course}
            />
          ))}
        </div>

        {/* Bottom Banner: Custom Training Support & Crew Certification */}
        <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-[#0D121F] via-[#141A2A] to-[#0D121F] border border-[#F05A28]/40 shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 text-xs font-mono text-[#F05A28] font-bold uppercase">
              <Users className="w-4 h-4" />
              <span>{t('courses.banner.badge')}</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-extrabold text-white font-sans">
              {t('courses.banner.title')}
            </h3>
            <p className="text-xs sm:text-sm text-[#E1E4E8]/80 leading-relaxed font-sans">
              {t('courses.banner.desc')}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0 w-full md:w-auto">
            <a
              href="https://wa.me/51949479379?text=Hola%20BEEMETRY,%20deseo%20coordinar%20una%20capacitaci%C3%B3n%20personalizada%20y%20certificaci%C3%B3n%20en%20el%20sistema%20para%20nuestra%20unidad%20minera."
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-[#F05A28]/25 flex items-center justify-center gap-2 active:scale-95 text-center"
            >
              <PhoneCall className="w-4 h-4" />
              <span>{t('courses.banner.ctaBtn')}</span>
            </a>
          </div>
        </div>

      </div>

    </section>
  );
};

// Export alias as CoursesSection as well for convenience
export const CoursesSection = TrainingCoursesSection;
