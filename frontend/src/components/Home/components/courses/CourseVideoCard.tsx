import React, { useState } from 'react';
import { 
  Play, Pause, Clock, BookOpen, CheckCircle2, Sparkles, 
  Layers, RotateCcw, Volume2, X, Download, FileText, ChevronRight 
} from 'lucide-react';
import { CourseItem } from '../../data/coursesData';
import { useI18n } from '../../../../i18n/I18nProvider'

interface CourseVideoCardProps {
  course: CourseItem;
}

export const CourseVideoCard: React.FC<CourseVideoCardProps> = ({ course }) => {
  const { t } = useI18n();
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeLessonIdx, setActiveLessonIdx] = useState<number>(0);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  const activeLesson = course.lessons[activeLessonIdx] || course.lessons[0];
  const currentVideoUrl = activeLesson?.videoUrl || course.videoUrl;

  const handleStartPlay = (lessonIndex?: number) => {
    if (typeof lessonIndex === 'number') {
      setActiveLessonIdx(lessonIndex);
    }
    setIsPlaying(true);
  };

  const handleStopVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPlaying(false);
  };

  const handleSimulateDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  return (
    <div className="group relative bg-[#0D121F] border border-[#3A3D40] hover:border-[#F05A28]/70 rounded-2xl overflow-hidden transition-all duration-300 shadow-xl flex flex-col justify-between">
      
      {/* 1. DIRECT INLINE VIDEO ENCADRE (Framing) */}
      <div>
        <div className="relative aspect-video w-full overflow-hidden bg-black border-b border-[#3A3D40]">
          
          {isPlaying ? (
            /* Active Live Video Stream / Player inside Frame */
            <div className="relative w-full h-full bg-black">
              <iframe
                src={currentVideoUrl}
                title={t(course.titleKey)}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />

              {/* Top floating bar to close video and return to preview */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5 z-20">
                <button
                  onClick={handleStopVideo}
                  className="px-2.5 py-1 rounded-md bg-black/85 hover:bg-[#F05A28] text-slate-200 hover:text-slate-950 border border-[#3A3D40] text-[11px] font-mono font-bold flex items-center gap-1 backdrop-blur-md transition-all"
                  title="Cerrar video y volver a la portada"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cerrar</span>
                </button>
              </div>
              
            </div>
          ) : (
            /* Poster & Play Action Frame */
            <div
              className="relative w-full h-full cursor-pointer"
              onClick={() => handleStartPlay(0)}
            >
              {/* Background Video Poster Image */}
              <img
                src={course.thumbnail}
                alt={t(course.titleKey)}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />

              {/* Dark Gradient Overlay for Contrast */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0D121F] via-black/40 to-black/20 group-hover:via-black/10 transition-colors" />

              {/* Top Floating Badges */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-bold tracking-wider uppercase bg-[#080C14]/90 backdrop-blur-md text-[#FCD3B0] border border-[#F05A28]/40 shadow-md">
                  {course.badge}
                </span>

                <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-semibold bg-black/80 backdrop-blur-md text-slate-200 border border-[#3A3D40] flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[#F05A28]" />
                  {course.duration}
                </span>
              </div>

              {/* Center Play Button Overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative flex items-center justify-center">
                  {/* Outer pulsing ring */}
                  <div className="absolute w-16 h-16 rounded-full bg-[#F05A28]/30 animate-ping group-hover:bg-[#F05A28]/50" />
                  {/* Main Play Circle */}
                  <button
                    aria-label="Reproducir video"
                    className="relative w-14 h-14 rounded-full bg-[#F05A28] text-slate-950 flex items-center justify-center shadow-xl shadow-[#F05A28]/40 group-hover:scale-110 group-hover:bg-white group-hover:text-[#F05A28] transition-all"
                  >
                    <Play className="w-6 h-6 fill-current translate-x-0.5" />
                  </button>
                </div>
              </div>

              {/* Bottom video bar preview */}
              <div className="absolute bottom-0 left-3 right-3 flex items-center justify-between text-[11px] font-mono text-slate-300">
                <span className="bg-[#080C14]/85 px-2 py-0.5 rounded border border-[#3A3D40] flex items-center gap-1.5 backdrop-blur-sm">
                  <BookOpen className="w-3 h-3 text-[#F05A28]" />
                  {course.lessons.length} {t('courses.card.modulesCount')}
                </span>
                <span className="bg-[#080C14]/85 px-2 py-0.5 rounded border border-[#3A3D40] text-[#FCD3B0] backdrop-blur-sm">
                  {t(course.levelLabelKey)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 2. COURSE CONTENT & CHAPTER LIST DIRECTLY IN CARD */}
        <div className="p-5 sm:p-6 space-y-4">
          
          {/* Category & Title */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-mono text-[#F05A28] font-bold">
              <Layers className="w-3.5 h-3.5" />
              <span>{t(course.categoryLabelKey)}</span>
            </div>
            
            <h3 
              onClick={() => handleStartPlay(0)}
              className="text-lg sm:text-xl font-extrabold text-white group-hover:text-[#FCD3B0] transition-colors leading-snug cursor-pointer font-sans"
            >
              {t(course.titleKey)}
            </h3>
            
            <p className="text-xs sm:text-sm text-[#E1E4E8]/80 leading-relaxed font-sans line-clamp-2">
              {t(course.summaryKey)}
            </p>
          </div>

          {/* Quick Chapters / Lessons Selector */}
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase font-bold text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3 h-3 text-[#F05A28]" />
                {t('courses.modal.modulesHeader')}:
              </span>
              <span className="text-[#FCD3B0] lowercase">{course.lessons.length} temas</span>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {course.lessons.map((lesson, idx) => {
                const isActive = isPlaying && activeLessonIdx === idx;
                return (
                  <button
                    key={lesson.id}
                    onClick={() => handleStartPlay(idx)}
                    className={`px-2.5 py-1.5 rounded-lg border text-left flex items-center justify-between gap-2 transition-all ${
                      isActive
                        ? 'bg-[#F05A28]/15 border-[#F05A28] text-white shadow-sm'
                        : 'bg-[#080C14] border-[#3A3D40]/70 text-slate-300 hover:border-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className={`w-4 h-4 rounded-full text-[10px] font-mono font-bold flex items-center justify-center shrink-0 ${
                        isActive ? 'bg-[#F05A28] text-slate-950' : 'bg-[#141A2A] text-slate-400'
                      }`}>
                        {idx + 1}
                      </span>
                      <span className="text-[11px] font-sans font-medium truncate">
                        {t(lesson.titleKey)}
                      </span>
                    </div>

                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {lesson.duration}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Key Learning Points */}
          <div className="p-3 rounded-xl bg-[#080C14] border border-[#3A3D40]/70 space-y-1.5">
            <p className="text-[10px] font-mono uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-[#F05A28]" />
              {t('courses.card.keyPointsTitle')}
            </p>
            <div className="space-y-1 text-xs text-slate-300 font-sans">
              {course.learningPointsKeys.slice(0, 2).map((pKey, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="text-[11px] leading-tight line-clamp-1">{t(pKey)}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* 3. FOOTER INFO & DIRECT ACTIONS */}
      <div className="px-5 pb-5 sm:px-6 sm:pb-6 pt-2 border-t border-[#3A3D40]/50 flex items-center justify-between gap-3">
        {/* Instructor */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#141A2A] border border-[#F05A28]/40 flex items-center justify-center text-xs font-mono font-bold text-[#FCD3B0] shrink-0">
            {course.instructor.avatarInitials}
          </div>
          <div className="truncate">
            <p className="text-xs font-bold text-slate-100 truncate">{course.instructor.name}</p>
            <p className="text-[10px] text-slate-400 font-mono truncate">{t(course.instructor.roleKey)}</p>
          </div>
        </div>

        {/* Action Button */}
        {isPlaying ? (
          <button
            onClick={handleStopVideo}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141A2A] hover:bg-[#1f283d] border border-[#3A3D40] text-slate-200 font-bold text-xs uppercase tracking-wider transition-all"
          >
            <X className="w-3.5 h-3.5" />
            <span>Detener</span>
          </button>
        ) : (
          <button
            onClick={() => handleStartPlay(0)}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{t('courses.card.watchBtn')}</span>
          </button>
        )}
      </div>

    </div>
  );
};
