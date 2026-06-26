import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Volume2, Maximize2 } from 'lucide-react';

export interface MusicPlayerProps {
  audioUrl: string;
  isDarkMode: boolean;
  onPreview?: () => void;
}

export const MusicPlayer: React.FC<MusicPlayerProps> = ({ audioUrl, isDarkMode, onPreview }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const normalizedUrl = useMemo(() => {
    if (!audioUrl) return '';
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://') || audioUrl.startsWith('data:')) return audioUrl;
    if (audioUrl.startsWith('local-resource://')) return audioUrl;
    const cleanPath = audioUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
    return `local-resource://${cleanPath.replace(/\\/g, '/')}`;
  }, [audioUrl]);

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => {
      if (!audio.seeking) setCurrentTime(audio.currentTime);
    };
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const handleProgressChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const newTime = parseFloat(e.target.value);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) audioRef.current.volume = newVolume;
  }, []);

  return (
    <div
      className={`nodrag nopan relative w-full ${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-gray-200'} rounded-lg p-3`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={normalizedUrl}
        preload="none"
        draggable={false}
        onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0; setDuration(e.currentTarget.duration); setCurrentTime(0); }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => console.error('[音乐播放器] 加载失败')}
      />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-300 hover:bg-gray-400 text-gray-700'}`}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={currentTime}
            disabled={duration <= 0}
            onChange={handleProgressChange}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={`nodrag nopan flex-1 h-1.5 rounded-full cursor-pointer ${duration > 0 ? '' : 'opacity-60 cursor-not-allowed'}`}
            style={{ accentColor: isDarkMode ? '#22c55e' : '#3b82f6' }}
            aria-label="播放进度"
            title="点击或拖拽选择播放位置"
          />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Volume2 className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
            <input type="range" min="0" max="1" step="0.1" value={volume} onChange={handleVolumeChange} className="w-16 h-1" title="音量" style={{ accentColor: isDarkMode ? '#22c55e' : '#3b82f6' }} />
          </div>
          {onPreview && (
            <button onClick={onPreview} className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white/70' : 'bg-gray-300/50 hover:bg-gray-400/50 text-gray-600'}`} title="放大播放">
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-center gap-1">
          <span className={`text-xs font-mono ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>{formatTime(currentTime)}</span>
          <span className={`text-xs font-mono ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>/ {formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
};
