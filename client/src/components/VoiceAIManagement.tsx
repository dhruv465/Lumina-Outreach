import React, { useState, useEffect } from 'react';
import api from '@/services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Mic, 
  Volume2, 
  Brain, 
  Zap, 
  TrendingUp, 
  RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';

interface VoicePersonality {
  id: string;
  name: string;
  description: string;
  languageSupport: string[];
  trainingMetrics: {
    adaptationAccuracy: number;
    customerSatisfactionScore: number;
    conversionRate: number;
  };
}

interface TrainingResults {
  personalityAccuracy: number;
  bilingualAccuracy: number;
  conversationalAccuracy: number;
  overallAccuracy: number;
  trainingComplete: boolean;
  modelVersion: string;
}

const VoiceAIManagement: React.FC = () => {
  const [personalities, setPersonalities] = useState<VoicePersonality[]>([]);
  const [selectedPersonality, setSelectedPersonality] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<'English' | 'Hindi'>('English');
  const [isModelTrained, setIsModelTrained] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [testText, setTestText] = useState('');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [trainingResults, setTrainingResults] = useState<TrainingResults | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    loadVoicePersonalities();
  }, []);

  const loadVoicePersonalities = async () => {
    try {
      const response = await api.get('/lumina-outreach/personalities');
      
      setPersonalities(response.data.personalities);
      setIsModelTrained(response.data.modelTrained);
      
      // Set first available personality as selected if none is selected
      if (response.data.personalities.length > 0 && !selectedPersonality) {
        setSelectedPersonality(response.data.personalities[0].id);
      }
    } catch (error) {
      console.error('Error loading voice personalities:', error);
      toast.error('Failed to load voice personalities');
    }
  };

  const trainVoiceModel = async () => {
    setIsTraining(true);
    setTrainingProgress(0);
    
    try {
      // Track training progress UI state
      const progressInterval = setInterval(() => {
        setTrainingProgress(prev => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + 5;
        });
      }, 500);

      const response = await api.post('/lumina-outreach/train-model');

      clearInterval(progressInterval);
      setTrainingProgress(100);

      setTrainingResults(response.data.trainingResults);
      setIsModelTrained(true);
      toast.success('Voice AI model trained successfully!');
    } catch (error) {
      console.error('Error training voice model:', error);
      toast.error('Failed to train voice model');
    } finally {
      setIsTraining(false);
    }
  };

  const synthesizeVoice = async () => {
    if (!testText.trim()) {
      toast.error('Please enter text to synthesize');
      return;
    }

    setIsSynthesizing(true);
    
    try {
      const response = await api.post('/lumina-outreach/synthesize-voice', {
        text: testText,
        personality: selectedPersonality,
        language: selectedLanguage
      });

      if (response.data.audioUrl) {
        setAudioUrl(response.data.audioUrl);
        toast.success('Voice synthesis completed');
      }
    } catch (error) {
      console.error('Error synthesizing voice:', error);
      toast.error('Failed to synthesize voice');
    } finally {
      setIsSynthesizing(false);
    }
  };

  const selectedPersonalityData = personalities.find(p => p.id === selectedPersonality);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Voice AI Management</h2>
          <p className="text-muted-foreground">
            Configure and train AI voice personalities for enhanced customer interactions
          </p>
        </div>
        <Badge variant={isModelTrained ? "default" : "secondary"}>
          {isModelTrained ? "Model Trained" : "Training Required"}
        </Badge>
      </div>

      {/* Training Section */}
      {!isModelTrained && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Voice AI Training
            </CardTitle>
            <CardDescription>
              Train the voice AI model with advanced conversational abilities and cultural awareness
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <Zap className="h-4 w-4" />
              <AlertDescription>
                The voice AI model needs to be trained before use. This will enable advanced conversation handling,
                personality adaptation, and bilingual support.
              </AlertDescription>
            </Alert>
            
            {isTraining && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Training Progress</span>
                  <span>{trainingProgress}%</span>
                </div>
                <Progress value={trainingProgress} className="w-full" />
              </div>
            )}

            <Button 
              onClick={trainVoiceModel} 
              disabled={isTraining}
              className="w-full"
            >
              {isTraining ? (
                <>
                  <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                  Training Model...
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" />
                  Train Voice AI Model
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Training Results */}
      {trainingResults && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Training Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 border rounded-xl">
                <div className="text-2xl font-bold text-green-600">
                  {Math.round(trainingResults.personalityAccuracy * 100)}%
                </div>
                <div className="text-sm text-gray-600">Personality Accuracy</div>
              </div>
              <div className="text-center p-4 border rounded-xl">
                <div className="text-2xl font-bold text-blue-600">
                  {Math.round(trainingResults.bilingualAccuracy * 100)}%
                </div>
                <div className="text-sm text-gray-600">Bilingual Accuracy</div>
              </div>
              <div className="text-center p-4 border rounded-xl">
                <div className="text-2xl font-bold text-purple-600">
                  {Math.round(trainingResults.conversationalAccuracy * 100)}%
                </div>
                <div className="text-sm text-gray-600">Conversation Accuracy</div>
              </div>
              <div className="text-center p-4 border rounded-xl">
                <div className="text-2xl font-bold text-orange-600">
                  {Math.round(trainingResults.overallAccuracy * 100)}%
                </div>
                <div className="text-sm text-gray-600">Overall Accuracy</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Voice Personalities */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Voice Personalities
          </CardTitle>
          <CardDescription>
            Advanced AI personalities with cultural intelligence and conversational adaptation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            {personalities.map((personality) => (
              <div
                key={personality.id}
                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedPersonality === personality.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setSelectedPersonality(personality.id)}
              >
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <h4 className="font-semibold">{personality.name}</h4>
                    <p className="text-sm text-gray-600">{personality.description}</p>
                    <div className="flex gap-2">
                      {personality.languageSupport.map((lang) => (
                        <Badge key={lang} variant="outline" className="text-xs">
                          {lang}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-sm">
                      <div className="text-gray-500">Adaptation Acc.</div>
                      <div className="font-semibold">
                        {Math.round(personality.trainingMetrics.adaptationAccuracy * 100)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Voice Synthesis Testing */}
      {isModelTrained && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5" />
              Voice Synthesis Testing
            </CardTitle>
            <CardDescription>
              Test voice synthesis with different personalities and languages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Voice Personality</label>
                <Select value={selectedPersonality} onValueChange={setSelectedPersonality}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select personality" />
                  </SelectTrigger>
                  <SelectContent>
                    {personalities.map((personality) => (
                      <SelectItem key={personality.id} value={personality.id}>
                        {personality.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Language</label>
                <Select value={selectedLanguage} onValueChange={(value: 'English' | 'Hindi') => setSelectedLanguage(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="Hindi">हिंदी (Hindi)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Test Text</label>
              <Textarea
                placeholder="Enter text to synthesize..."
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={synthesizeVoice} 
                disabled={isSynthesizing || !testText.trim()}
                className="flex-1"
              >
                {isSynthesizing ? (
                  <>
                    <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                    Synthesizing...
                  </>
                ) : (
                  <>
                    <Volume2 className="mr-2 h-4 w-4" />
                    Synthesize Voice
                  </>
                )}
              </Button>
            </div>

            {audioUrl && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <label className="text-sm font-medium block mb-2">Generated Audio</label>
                <audio controls className="w-full">
                  <source src={audioUrl} type="audio/mpeg" />
                  Your browser does not support the audio element.
                </audio>
              </div>
            )}

            {selectedPersonalityData && (
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium mb-2">Selected Personality: {selectedPersonalityData.name}</h4>
                <p className="text-sm text-gray-600 mb-2">{selectedPersonalityData.description}</p>
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Adaptation:</span>
                    <span className="ml-1 font-medium">
                      {Math.round(selectedPersonalityData.trainingMetrics.adaptationAccuracy * 100)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Satisfaction:</span>
                    <span className="ml-1 font-medium">
                      {Math.round(selectedPersonalityData.trainingMetrics.customerSatisfactionScore * 100)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Conversion:</span>
                    <span className="ml-1 font-medium">
                      {Math.round(selectedPersonalityData.trainingMetrics.conversionRate * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default VoiceAIManagement;
