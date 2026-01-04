import { GoogleGenAI } from "@google/genai";

declare global {
  // Add type definitions for the Web Speech API to resolve TypeScript errors.
  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly [index: number]: SpeechRecognitionAlternative;
    readonly length: number;
  }

  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;

    start(): void;
    stop(): void;
  }

  interface Window {
    SpeechRecognition: { new(): SpeechRecognition };
    webkitSpeechRecognition: { new(): SpeechRecognition };
  }
}

interface HistoryItem {
  id: number;
  imageUrl: string;
  prompt: string;
  response: string;
}

class App {
  private ai: GoogleGenAI;
  private videoStream: MediaStream | null = null;
  private isCameraActive = false;
  private currentFacingMode: 'user' | 'environment' = 'environment';
  private speechRecognition: SpeechRecognition | null = null;
  private isRecording = false;
  private speechSynthesis: SpeechSynthesis | null = null;
  private history: HistoryItem[] = [];
  private historyIdCounter = 0;

  // DOM Elements
  private cameraButton: HTMLButtonElement;
  private switchCameraButton: HTMLButtonElement;
  private askButton: HTMLButtonElement;
  private recordButton: HTMLButtonElement;
  private clearHistoryButton: HTMLButtonElement;
  private exportHistoryButton: HTMLButtonElement;
  private promptInput: HTMLTextAreaElement;
  private visionContainer: HTMLDivElement;
  private videoFeed: HTMLVideoElement;
  private loadingIndicator: HTMLDivElement;
  private historyContainer: HTMLDivElement;
  private historyHeader: HTMLDivElement;


  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

    this.cameraButton = document.getElementById('camera-button') as HTMLButtonElement;
    this.switchCameraButton = document.getElementById('switch-camera-button') as HTMLButtonElement;
    this.askButton = document.getElementById('ask-button') as HTMLButtonElement;
    this.recordButton = document.getElementById('record-button') as HTMLButtonElement;
    this.clearHistoryButton = document.getElementById('clear-history-button') as HTMLButtonElement;
    this.exportHistoryButton = document.getElementById('export-history-button') as HTMLButtonElement;
    this.promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
    this.visionContainer = document.getElementById('vision-container') as HTMLDivElement;
    this.videoFeed = document.getElementById('video-feed') as HTMLVideoElement;
    this.loadingIndicator = document.getElementById('loading-indicator') as HTMLDivElement;
    this.historyContainer = document.getElementById('history-container') as HTMLDivElement;
    this.historyHeader = document.getElementById('history-header') as HTMLDivElement;
    
    this.init();
  }

  private init(): void {
    this.cameraButton.addEventListener('click', () => this.toggleCamera());
    this.switchCameraButton.addEventListener('click', () => this.switchCamera());
    this.askButton.addEventListener('click', () => this.askAI());
    this.clearHistoryButton.addEventListener('click', () => this.clearHistory());
    this.exportHistoryButton.addEventListener('click', () => this.exportHistory());
    this.promptInput.addEventListener('input', () => this.validateInput());

    this.initSpeechRecognition();
    this.initSpeechSynthesis();
    this.loadHistory();
  }
  
  private initSpeechRecognition(): void {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionAPI) {
      this.speechRecognition = new SpeechRecognitionAPI();
      this.speechRecognition.lang = 'ja-JP';
      this.speechRecognition.interimResults = false;
      this.speechRecognition.maxAlternatives = 1;

      this.speechRecognition.onresult = (event) => this.handleSpeechResult(event);
      this.speechRecognition.onend = () => {
        if (this.isRecording) {
            this.stopRecording();
        }
      };
      this.speechRecognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (this.isRecording) {
            this.stopRecording();
        }
      };
      
      this.recordButton.addEventListener('click', () => this.toggleRecording());

    } else {
      console.warn('Speech Recognition API is not supported in this browser.');
      this.recordButton.style.display = 'none';
    }
  }

  private initSpeechSynthesis(): void {
    if ('speechSynthesis' in window) {
      this.speechSynthesis = window.speechSynthesis;
      // Ensure any lingering speech is stopped on page refresh/load
      this.speechSynthesis.cancel();
    } else {
      console.warn('Speech Synthesis API is not supported in this browser.');
    }
  }

  private async toggleCamera(): Promise<void> {
    if (this.isCameraActive) {
      this.stopCamera();
    } else {
      // Ensure we start with the default camera when activating from off state.
      this.currentFacingMode = 'environment';
      await this.startCamera();
    }
  }

  private async switchCamera(): Promise<void> {
    if (!this.isCameraActive) return;
    this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    await this.startCamera();
  }

  private async startCamera(): Promise<void> {
    // Stop any existing stream first to ensure a clean start, especially for switching.
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
    }

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode },
        audio: false
      });
      this.videoFeed.srcObject = this.videoStream;
      this.visionContainer.classList.remove('hidden');
      this.cameraButton.textContent = 'カメラを停止';
      this.switchCameraButton.classList.remove('hidden');
      this.isCameraActive = true;
      this.recordButton.disabled = false;
      this.validateInput();
    } catch (error) {
      console.error('Error accessing camera:', error);
      // Use history to show error message
      const errorItem: HistoryItem = {
          id: this.historyIdCounter++,
          imageUrl: '',
          prompt: 'カメラの初期化',
          response: 'カメラへのアクセスに失敗しました。ブラウザの権限設定を確認してください。',
        };
      this.history.unshift(errorItem);
      this.saveHistory();
      this.renderHistory();
      this.stopCamera(); // Clean up UI on failure
    }
  }

  private stopCamera(): void {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
    }
    this.videoFeed.srcObject = null;
    this.visionContainer.classList.add('hidden');
    this.cameraButton.textContent = 'カメラを起動';
    this.switchCameraButton.classList.add('hidden');
    this.isCameraActive = false;
    this.videoStream = null;
    this.recordButton.disabled = true;
    this.validateInput();
  }
  
  private validateInput(): void {
    const hasText = this.promptInput.value.trim().length > 0;
    this.askButton.disabled = !hasText || !this.isCameraActive;
  }
  
  private toggleRecording(): void {
    if (!this.speechRecognition) return;
    this.isRecording ? this.stopRecording() : this.startRecording();
  }

  private startRecording(): void {
    if (!this.speechRecognition || this.isRecording) return;
    this.isRecording = true;
    this.recordButton.textContent = '録音停止';
    this.recordButton.classList.add('recording');
    this.askButton.disabled = true;
    this.cameraButton.disabled = true;
    this.switchCameraButton.disabled = true;
    this.speechRecognition.start();
  }

  private stopRecording(): void {
    if (!this.speechRecognition || !this.isRecording) return;
    
    this.isRecording = false;
    this.speechRecognition.stop();
    this.recordButton.textContent = '音声入力';
    this.recordButton.classList.remove('recording');
    this.cameraButton.disabled = false;
    this.switchCameraButton.disabled = false;
    this.validateInput();
  }
  
  private handleSpeechResult(event: SpeechRecognitionEvent): void {
    const transcript = event.results[event.results.length - 1][0].transcript;
    this.promptInput.value = transcript;
    this.validateInput();
  }

  private captureFrameAsBase64(): string {
    const canvas = document.createElement('canvas');
    canvas.width = this.videoFeed.videoWidth;
    canvas.height = this.videoFeed.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error("Could not get 2d context from canvas");
    }
    context.drawImage(this.videoFeed, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  }

  private async askAI(): Promise<void> {
    const prompt = this.promptInput.value.trim();
    if (!prompt || !this.isCameraActive) return;

    this.setLoading(true);
    if (this.speechSynthesis?.speaking) {
      this.speechSynthesis.cancel();
    }

    try {
      const base64Image = this.captureFrameAsBase64();
      const imageUrl = `data:image/jpeg;base64,${base64Image}`;

      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType: 'image/jpeg'
        }
      };

      const textPart = { text: prompt };

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] }
      });
      
      const rawText = response.text;
      // Remove markdown-like formatting characters for cleaner display and speech synthesis.
      const cleanedText = rawText.replace(/[*#_`]/g, '');
      
      const newHistoryItem: HistoryItem = {
        id: this.historyIdCounter++,
        imageUrl: imageUrl,
        prompt: prompt,
        response: cleanedText,
      };

      this.history.unshift(newHistoryItem);
      this.saveHistory();
      this.renderHistory();
      
      // Automatically speak the new response.
      const firstHistoryItem = this.historyContainer.firstChild as HTMLElement;
      if (firstHistoryItem) {
        const speakButton = firstHistoryItem.querySelector('.speak-button') as HTMLButtonElement | null;
        if (speakButton && cleanedText) {
          this.speakText(cleanedText, speakButton);
        }
      }

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      const errorItem: HistoryItem = {
        id: this.historyIdCounter++,
        imageUrl: `data:image/jpeg;base64,${this.captureFrameAsBase64()}`, // Still show image on error
        prompt: prompt,
        response: 'AIからの回答取得中にエラーが発生しました。',
      };
      this.history.unshift(errorItem);
      this.saveHistory();
      this.renderHistory();
    } finally {
      this.promptInput.value = '';
      this.validateInput();
      this.setLoading(false);
    }
  }

  private saveHistory(): void {
    localStorage.setItem('visionHistory', JSON.stringify(this.history));
  }

  private loadHistory(): void {
    const savedHistory = localStorage.getItem('visionHistory');
    if (savedHistory) {
      this.history = JSON.parse(savedHistory);
      if (this.history.length > 0) {
        // Ensure the ID counter is higher than any existing ID to prevent duplicates
        this.historyIdCounter = Math.max(...this.history.map(item => item.id)) + 1;
      }
    }
    this.renderHistory();
  }

  private clearHistory(): void {
    if (this.history.length > 0 && confirm('本当に履歴をすべて消去しますか？')) {
      this.history = [];
      this.saveHistory();
      this.renderHistory();
    }
  }

  private escapeHtml(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
  }

  private exportHistory(): void {
    if (this.history.length === 0) {
      alert('エクスポートする履歴がありません。');
      return;
    }

    // History is unshifted (newest first), so reverse for chronological export.
    const chronologicalHistory = [...this.history].reverse();

    const historyHtml = chronologicalHistory.map(item => `
      <div class="history-item-export">
        ${item.imageUrl ? `<img src="${item.imageUrl}" alt="解析された画像">` : ''}
        <div class="history-content-export">
          <p><strong>質問：</strong> ${this.escapeHtml(item.prompt)}</p>
          <p><strong>回答：</strong> ${this.escapeHtml(item.response)}</p>
        </div>
      </div>
    `).join('\n');

    const fullHtml = `
  <!DOCTYPE html>
  <html lang="ja">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>リアルタイムビジョンアナライザー - 解析履歴</title>
    <style>
      body { font-family: 'Noto Sans JP', sans-serif; margin: 0; padding: 24px; background-color: #f4f5f7; color: #333; }
      h1, h2 { color: #4a90e2; }
      #export-container { max-width: 800px; margin: auto; background-color: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
      .history-item-export { border: 1px solid #ddd; border-radius: 12px; padding: 16px; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); overflow: hidden; }
      img { display: block; width: 100%; height: auto; border-radius: 8px; margin-bottom: 16px; }
      p { margin: 0 0 8px; line-height: 1.7; word-wrap: break-word; }
      strong { font-weight: 700; }
    </style>
  </head>
  <body>
    <div id="export-container">
      <h1>解析履歴</h1>
      <h2>エクスポート日時: ${new Date().toLocaleString('ja-JP')}</h2>
      ${historyHtml}
    </div>
  </body>
  </html>
    `;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    a.download = `vision_history_${timestamp}.html`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  private renderHistory(): void {
    const hasHistory = this.history.length > 0;

    this.historyHeader.classList.toggle('hidden', !hasHistory);
    this.exportHistoryButton.disabled = !hasHistory;

    if (!hasHistory) {
      this.historyContainer.innerHTML = '';
      return;
    }

    this.historyContainer.innerHTML = '';

    this.history.forEach(item => {
      const historyItemEl = document.createElement('div');
      historyItemEl.className = 'history-item';

      let imageHtml = '';
      if (item.imageUrl) {
        imageHtml = `<img src="${item.imageUrl}" alt="解析された画像">`;
      }

      historyItemEl.innerHTML = `
        ${imageHtml}
        <div class="history-content">
          <p class="prompt-text"><strong>質問：</strong> ${item.prompt}</p>
          <div class="response-wrapper">
            <p class="response-text">${item.response}</p>
          </div>
        </div>
      `;
      
      if (item.response) {
        const responseWrapper = historyItemEl.querySelector('.response-wrapper') as HTMLDivElement;
        const speakButton = document.createElement('button');
        speakButton.className = 'speak-button';
        speakButton.innerHTML = '🔊';
        speakButton.setAttribute('aria-label', '回答を読み上げる');
        
        speakButton.addEventListener('click', () => {
          const isCurrentlySpeaking = speakButton.classList.contains('speaking');
          if (this.speechSynthesis?.speaking) {
            this.speechSynthesis.cancel();
          }
          if (!isCurrentlySpeaking) {
            this.speakText(item.response, speakButton);
          }
        });

        responseWrapper.appendChild(speakButton);
      }

      this.historyContainer.appendChild(historyItemEl);
    });
  }

  private speakText(text: string, button: HTMLButtonElement): void {
    if (!this.speechSynthesis || !text) return;

    if (this.speechSynthesis.speaking) {
        this.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    
    utterance.onstart = () => {
        button.textContent = '⏹️';
        button.classList.add('speaking');
        button.setAttribute('aria-label', '音声出力を停止');
    };

    utterance.onend = () => {
        button.textContent = '🔊';
        button.classList.remove('speaking');
        button.setAttribute('aria-label', '回答を読み上げる');
    };

    utterance.onerror = (event: any) => {
        // The 'interrupted' error is expected when speech is manually stopped.
        if (event.error === 'interrupted') {
            return;
        }
        console.error('Speech synthesis error:', event.error);
        button.textContent = '🔊';
        button.classList.remove('speaking');
        button.setAttribute('aria-label', '回答を読み上げる');
    };

    this.speechSynthesis.speak(utterance);
  }

  private setLoading(isLoading: boolean): void {
    if (isLoading) {
      this.loadingIndicator.classList.remove('hidden');
      this.askButton.disabled = true;
      this.recordButton.disabled = true;
      this.switchCameraButton.disabled = true;
      this.promptInput.disabled = true;
    } else {
      this.loadingIndicator.classList.add('hidden');
      this.promptInput.disabled = false;
      this.recordButton.disabled = !this.isCameraActive;
      this.switchCameraButton.disabled = !this.isCameraActive;
      this.validateInput();
    }
  }
}

new App();