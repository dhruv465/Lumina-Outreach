import React, { useEffect, useRef } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';

interface TranscriptEntry {
  id: string;
  speaker: 'agent' | 'user';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

interface WebCallTranscriptProps {
  transcript: TranscriptEntry[];
  currentSpeaker: 'agent' | 'user' | null;
  height?: string | number;
  className?: string;
}

/**
 * WebCallTranscript Component
 * 
 * Displays a real-time transcript of the web call conversation with speaker identification
 * and highlighting for current speech
 */
const WebCallTranscript: React.FC<WebCallTranscriptProps> = ({
  transcript,
  currentSpeaker,
  height = '300px',
  className = ''
}) => {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when transcript updates
  useEffect(() => {
    if (endOfMessagesRef.current) {
      endOfMessagesRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);
  
  // Format timestamp
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  // Group consecutive messages from the same speaker
  const groupedTranscript = transcript.reduce<{
    speaker: 'agent' | 'user';
    entries: TranscriptEntry[];
    timestamp: number;
  }[]>((acc, entry) => {
    const lastGroup = acc[acc.length - 1];
    
    if (lastGroup && lastGroup.speaker === entry.speaker) {
      // Add to existing group
      lastGroup.entries.push(entry);
      return acc;
    } else {
      // Create new group
      acc.push({
        speaker: entry.speaker,
        entries: [entry],
        timestamp: entry.timestamp
      });
      return acc;
    }
  }, []);
  
  return (
    <div 
      className={`web-call-transcript border rounded-md bg-background ${className}`}
      style={{ height }}
    >
      <div className="p-2 border-b bg-muted/50 flex items-center justify-between">
        <h4 className="text-sm font-medium">Conversation Transcript</h4>
        <div className="flex items-center gap-2">
          {currentSpeaker && (
            <Badge variant={currentSpeaker === 'agent' ? 'default' : 'secondary'}>
              {currentSpeaker === 'agent' ? 'Agent Speaking' : 'User Speaking'}
            </Badge>
          )}
        </div>
      </div>
      
      <ScrollArea className="h-[calc(100%-40px)]" ref={scrollAreaRef}>
        <div className="p-3 space-y-4">
          {groupedTranscript.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Conversation transcript will appear here
            </div>
          ) : (
            groupedTranscript.map((group, index) => (
              <div 
                key={index} 
                className={`flex flex-col ${group.speaker === 'agent' ? 'items-start' : 'items-end'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={group.speaker === 'agent' ? 'default' : 'secondary'}>
                    {group.speaker === 'agent' ? 'Agent' : 'You'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(group.timestamp)}
                  </span>
                </div>
                
                <div 
                  className={`rounded-lg p-3 max-w-[80%] ${
                    group.speaker === 'agent' 
                      ? 'bg-primary/10 text-primary-foreground' 
                      : 'bg-secondary/20 text-secondary-foreground'
                  } ${
                    currentSpeaker === group.speaker && index === groupedTranscript.length - 1
                      ? 'border-2 border-primary animate-pulse'
                      : ''
                  }`}
                >
                  {group.entries.map((entry, i) => (
                    <div 
                      key={entry.id} 
                      className={`${!entry.isFinal ? 'italic text-muted-foreground' : ''} ${i > 0 ? 'mt-1' : ''}`}
                    >
                      {entry.text}
                      {!entry.isFinal && (
                        <span className="text-xs ml-1 text-muted-foreground">(processing...)</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          <div ref={endOfMessagesRef} />
        </div>
      </ScrollArea>
    </div>
  );
};

export default WebCallTranscript;