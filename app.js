let fileBuffer = null;
let audioCtx = null;
let currentSourceNode = null;
let startTime = 0;
let pauseOffset = 0;
let audioDuration = 0;
let animationFrameId = null;
let isPaused = false;
let mediaRecorder = null;
let recordedChunks = [];

const CONSOLE_PALETTES = {
  megadrive: ["#000000","#222222","#444444","#666666","#888888","#aaaaaa","#cccccc","#ffffff","#e00000","#00e000","#00e0e0","#e0e000","#e000e0","#00e0e0","#ee8800","#884400"],
  mastersystem: ["#000000","#550000","#aa0000","#ff0000","#005500","#555500","#aa5500","#ff5500","#00aa00","#55aa00","#aaaa00","#ffaa00","#00ff00","#55ff00","#aaff00","#ffff00"],
  nes: ["#7c7c7c","#0000fc","#0000bc","#4428bc","#940084","#a80020","#a81000","#881400","#503000","#007800","#006800","#005800","#004058","#000000","#000000","#000000"],
  gameboy: ["#0f380f","#306230","#8bac0f","#9bbc0f","#0f380f","#306230","#8bac0f","#9bbc0f","#0f380f","#306230","#8bac0f","#9bbc0f","#0f380f","#306230","#8bac0f","#9bbc0f"],
  snes: ["#000000","#1f0000","#3f0000","#7f0000","#001f00","#003f00","#007f00","#00001f","#00003f","#00007f","#7f7f00","#7f007f","#007f7f","#7f7f7f","#3f3f3f","#ffffff"]
};

let customPalette = [...CONSOLE_PALETTES.megadrive];

// Elementos DOM
const canvas = document.getElementById("waterfallCanvas");
const ctx = canvas.getContext("2d");
const fileInput = document.getElementById("fileInput");
const frameWidthInput = document.getElementById("frameWidth");
const frameHeightInput = document.getElementById("frameHeight");
const zoomSelect = document.getElementById("zoomSelect");
const paletteFileInput = document.getElementById("paletteFileInput");
const bppSelect = document.getElementById("bppSelect");
const layoutModeSelect = document.getElementById("layoutModeSelect");
const tileWidthSelect = document.getElementById("tileWidthSelect");
const tileHeightSelect = document.getElementById("tileHeightSelect");
const paletteSelect = document.getElementById("paletteSelect");
const paletteInputsContainer = document.getElementById("paletteInputs");
const statusText = document.getElementById("statusText");
const seekSlider = document.getElementById("seekSlider");
const currentTimeEl = document.getElementById("currentTime");
const totalTimeEl = document.getElementById("totalTime");
const hexOffsetEl = document.getElementById("hexOffset");
const sampleRateInput = document.getElementById("sampleRateInput");
const audioFormatSelect = document.getElementById("audioFormatSelect");
const manualOffsetInput = document.getElementById("manualOffsetInput");
const themeSelect = document.getElementById("themeSelect");
const btnDetectBpp = document.getElementById("btnDetectBpp");

// Menu Dropdown
const menuFileBtn = document.getElementById("menuFileBtn");
const fileDropdown = document.getElementById("fileDropdown");

menuFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileDropdown.classList.toggle("hidden");
});

document.addEventListener("click", () => fileDropdown.classList.add("hidden"));

document.getElementById("menuOpenBin").addEventListener("click", () => fileInput.click());
document.getElementById("menuImportPal").addEventListener("click", () => paletteFileInput.click());
document.getElementById("menuExportPalBin").addEventListener("click", exportPaletteToMDBin);
document.getElementById("btnExportPaletteBinSidebar").addEventListener("click", exportPaletteToMDBin);
document.getElementById("menuReset").addEventListener("click", () => stopBinaryAudio());

themeSelect.addEventListener("change", (e) => {
  document.documentElement.setAttribute("data-theme", e.target.value);
});

// Gera paleta padrão estável de 256 cores (RGB332) para 8 BPP
function generateDefault8BitPalette() {
  let palette = [];
  for (let i = 0; i < 256; i++) {
    let r = Math.round(((i >> 5) & 0x07) * (255 / 7));
    let g = Math.round(((i >> 2) & 0x07) * (255 / 7));
    let b = Math.round((i & 0x03) * (255 / 3));
    let hex = "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    palette.push(hex);
  }
  return palette;
}

function initPaletteInputs() {
  paletteInputsContainer.innerHTML = "";
  const bppMode = bppSelect ? bppSelect.value : "4";
  
  let maxColors = 16;
  if (bppMode === "2") maxColors = 4;
  else if (bppMode === "4" || bppMode === "4_md") maxColors = 16;
  else if (bppMode === "8") maxColors = 256;
  else if (["16", "24", "32", "exe"].includes(bppMode)) maxColors = 0;

  // Ajusta o tamanho e conteúdo da customPalette conforme o BPP
  if (bppMode === "8") {
    if (customPalette.length < 256) {
      customPalette = generateDefault8BitPalette();
    }
  } else if (bppMode === "4" || bppMode === "4_md") {
    if (customPalette.length !== 16) {
      customPalette = [...CONSOLE_PALETTES.megadrive];
    }
  } else if (bppMode === "2") {
    if (customPalette.length !== 4) {
      customPalette = CONSOLE_PALETTES.gameboy.slice(0, 4);
    }
  }

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < maxColors; i++) {
    const color = customPalette[i] || "#000000";
    const input = document.createElement("input");
    input.type = "color";
    input.value = color;
    
    input.addEventListener("input", (e) => {
      customPalette[i] = e.target.value;
      renderWaterfall(getByteOffsetFromProgress());
    });

    fragment.appendChild(input);
  }

  paletteInputsContainer.appendChild(fragment);
}

initPaletteInputs();

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    fileBuffer = new Uint8Array(evt.target.result);
    document.getElementById("fileInfo").innerText = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    pauseOffset = 0;
    isPaused = false;
    prepareAudioDuration();
    autoDetectBpp();
  };
  reader.readAsArrayBuffer(file);
});

btnDetectBpp.addEventListener("click", autoDetectBpp);

function autoDetectBpp() {
  if (!fileBuffer || fileBuffer.length === 0) return;

  const sampleSize = Math.min(fileBuffer.length, 65536);
  let zeroCount = 0;
  let ffCount = 0;
  let uniqueBytes = new Set();

  for (let i = 0; i < sampleSize; i++) {
    const b = fileBuffer[i];
    if (b === 0x00) zeroCount++;
    if (b === 0xFF) ffCount++;
    uniqueBytes.add(b);
  }

  const uniqueRatio = uniqueBytes.size / 256;
  let suggestedBpp = "4_md";

  if (uniqueBytes.size <= 4) {
    suggestedBpp = "2";
  } else if (uniqueBytes.size <= 16) {
    suggestedBpp = "4";
  } else if (uniqueRatio > 0.85 && (zeroCount + ffCount) / sampleSize < 0.1) {
    suggestedBpp = "24";
  } else if (uniqueRatio > 0.6) {
    suggestedBpp = "8";
  } else {
    suggestedBpp = "4_md";
  }

  bppSelect.value = suggestedBpp;
  initPaletteInputs();
  renderWaterfall(getByteOffsetFromProgress());
  statusText.innerText = `Detector: BPP sugerido -> Modo [${suggestedBpp}]`;
}

paletteFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  if (file.name.endsWith(".bin") || file.name.endsWith(".pal") || file.size <= 512) {
    reader.onload = (evt) => {
      const buf = new Uint8Array(evt.target.result);
      let extractedColors = [];

      for (let i = 0; i < buf.length - 1 && extractedColors.length < 256; i += 2) {
        let b1 = buf[i];
        let b2 = buf[i + 1];

        let red = (b2 & 0x0E) >> 1;
        let green = (b2 & 0xE0) >> 5;
        let blue = (b1 & 0x0E) >> 1;

        let r = Math.round(red * (255 / 7));
        let g = Math.round(green * (255 / 7));
        let b = Math.round(blue * (255 / 7));

        let hex = "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        extractedColors.push(hex);
      }

      if (extractedColors.length > 0) {
        customPalette = extractedColors;
        initPaletteInputs();
        renderWaterfall(getByteOffsetFromProgress());
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = (evt) => {
      const text = evt.target.result;
      const hexMatches = text.match(/#[0-9a-fA-F]{6}/g);
      if (hexMatches && hexMatches.length > 0) {
        customPalette = hexMatches;
        initPaletteInputs();
        renderWaterfall(getByteOffsetFromProgress());
      }
    };
    reader.readAsText(file);
  }
});

function exportPaletteToMDBin() {
  const bppMode = bppSelect ? bppSelect.value : "4";
  let maxColors = 16;
  if (bppMode === "2") maxColors = 4;
  else if (bppMode === "4" || bppMode === "4_md") maxColors = 16;
  else if (bppMode === "8") maxColors = 256;

  const binBuffer = new Uint8Array(maxColors * 2);

  for (let i = 0; i < maxColors; i++) {
    const hex = customPalette[i] || "#000000";
    const rgb = hexToRgb(hex);

    const rMD = (Math.round((rgb.r / 255) * 7) * 2) & 0x0E;
    const gMD = (Math.round((rgb.g / 255) * 7) * 2) & 0x0E;
    const bMD = (Math.round((rgb.b / 255) * 7) * 2) & 0x0E;

    const byteHigh = bMD;
    const byteLow = (gMD << 4) | rMD;

    binBuffer[i * 2] = byteHigh;
    binBuffer[i * 2 + 1] = byteLow;
  }

  const blob = new Blob([binBuffer], { type: "application/octet-stream" });
  downloadBlob(blob, `palette_megadrive_${maxColors}c.bin`);
}

// AJUSTE DE DIMENSÃO DE 1 EM 1 PIXEL
const DIMENSION_STEP = 1;

function snapInputToStep(inputElement) {
  let val = parseInt(inputElement.value) || 1;
  inputElement.value = Math.max(1, Math.round(val / DIMENSION_STEP) * DIMENSION_STEP);
}

frameWidthInput.addEventListener("change", (e) => {
  snapInputToStep(e.target);
  renderWaterfall(getByteOffsetFromProgress());
});

frameHeightInput.addEventListener("change", (e) => {
  snapInputToStep(e.target);
  renderWaterfall(getByteOffsetFromProgress());
});

frameWidthInput.addEventListener("input", () => renderWaterfall(getByteOffsetFromProgress()));
frameHeightInput.addEventListener("input", () => renderWaterfall(getByteOffsetFromProgress()));

zoomSelect.addEventListener("change", () => renderWaterfall(getByteOffsetFromProgress()));

bppSelect.addEventListener("change", () => {
  initPaletteInputs();
  renderWaterfall(getByteOffsetFromProgress());
});

layoutModeSelect.addEventListener("change", () => {
  const isTileMode = layoutModeSelect.value === "tiles";
  tileWidthSelect.disabled = !isTileMode;
  tileHeightSelect.disabled = !isTileMode;
  renderWaterfall(getByteOffsetFromProgress());
});

if (tileWidthSelect) tileWidthSelect.addEventListener("change", () => renderWaterfall(getByteOffsetFromProgress()));
if (tileHeightSelect) tileHeightSelect.addEventListener("change", () => renderWaterfall(getByteOffsetFromProgress()));

paletteSelect.addEventListener("change", (e) => {
  if (CONSOLE_PALETTES[e.target.value]) {
    customPalette = [...CONSOLE_PALETTES[e.target.value]];
    initPaletteInputs();
  }
  renderWaterfall(getByteOffsetFromProgress());
});

manualOffsetInput.addEventListener("change", () => {
  if (!fileBuffer) return;
  let valStr = manualOffsetInput.value.trim();
  let byteOffset = 0;

  if (valStr.toLowerCase().startsWith("0x")) {
    byteOffset = parseInt(valStr, 16) || 0;
  } else {
    byteOffset = parseInt(valStr, 10) || 0;
  }

  byteOffset = Math.max(0, Math.min(fileBuffer.length - 1, byteOffset));
  const progressRatio = byteOffset / fileBuffer.length;
  pauseOffset = progressRatio * audioDuration;

  updateSeekUI(pauseOffset);
  renderWaterfall(byteOffset);

  if (currentSourceNode && !isPaused) {
    playBinaryAudio(pauseOffset);
  }
});

sampleRateInput.addEventListener("input", () => {
  if (fileBuffer) {
    const currentProgressPercent = parseFloat(seekSlider.value) / 100;
    const isPlaying = !!currentSourceNode && !isPaused;
    prepareAudioDuration();
    pauseOffset = currentProgressPercent * audioDuration;

    if (isPlaying) playBinaryAudio(pauseOffset);
    else updateSeekUI(pauseOffset);
  }
});

audioFormatSelect.addEventListener("change", () => {
  if (fileBuffer) {
    const isPlaying = !!currentSourceNode && !isPaused;
    prepareAudioDuration();
    if (isPlaying) playBinaryAudio(pauseOffset);
  }
});

// Renderizador Universal de Canvas
function renderWaterfall(startByteOffset = 0) {
  if (!fileBuffer) return;

  const width = parseInt(frameWidthInput.value) || 256;
  const height = parseInt(frameHeightInput.value) || 256;
  const zoom = parseFloat(zoomSelect.value) || 1;
  const bppMode = bppSelect.value;
  const isTileLayout = layoutModeSelect.value === "tiles";

  const tileW = isTileLayout ? (parseInt(tileWidthSelect.value) || 8) : width;
  const tileH = isTileLayout ? (parseInt(tileHeightSelect.value) || 8) : 1;

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * zoom}px`;
  canvas.style.height = `${height * zoom}px`;

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  let bytesPerPixel = 1;
  if (bppMode === "2") bytesPerPixel = 0.25;
  else if (bppMode === "4" || bppMode === "4_md") bytesPerPixel = 0.5;
  else if (bppMode === "8") bytesPerPixel = 1;
  else if (bppMode === "16") bytesPerPixel = 2;
  else if (bppMode === "24") bytesPerPixel = 3;
  else if (bppMode === "32" || bppMode === "exe") bytesPerPixel = 4;

  const tilesPerRow = Math.floor(width / tileW);
  const tilesPerCol = Math.floor(height / tileH);
  const totalTiles = tilesPerRow * tilesPerCol;
  const bytesPerTile = Math.ceil(tileW * tileH * bytesPerPixel);

  for (let t = 0; t < totalTiles; t++) {
    const tileX = (t % tilesPerRow) * tileW;
    const tileY = Math.floor(t / tilesPerRow) * tileH;
    const tileByteOffset = startByteOffset + (t * bytesPerTile);

    for (let py = 0; py < tileH; py++) {
      for (let px = 0; px < tileW; px++) {
        const posX = tileX + px;
        const posY = tileY + py;

        if (posX >= width || posY >= height) continue;

        const pixelIndexInTile = (py * tileW) + px;
        const currentByteIdx = tileByteOffset + Math.floor(pixelIndexInTile * bytesPerPixel);

        if (currentByteIdx >= fileBuffer.length) continue;

        let r = 0, g = 0, b = 0, a = 255;

        if (bppMode === "4_md" || bppMode === "4") {
          const bVal = fileBuffer[currentByteIdx];
          const isHighNibble = (pixelIndexInTile % 2) === 0;
          const palIdx = isHighNibble ? ((bVal >> 4) & 0x0F) : (bVal & 0x0F);
          const rgb = hexToRgb(customPalette[palIdx] || "#000000");
          r = rgb.r; g = rgb.g; b = rgb.b;
        }
        else if (bppMode === "2") {
          const bVal = fileBuffer[currentByteIdx];
          const bitShift = (3 - (pixelIndexInTile % 4)) * 2;
          const palIdx = (bVal >> bitShift) & 0x03;
          const rgb = hexToRgb(customPalette[palIdx] || "#000000");
          r = rgb.r; g = rgb.g; b = rgb.b;
        }
        else if (bppMode === "8") {
          const val = fileBuffer[currentByteIdx];
          const hexColor = customPalette[val] || "#000000";
          const rgb = hexToRgb(hexColor);
          r = rgb.r; g = rgb.g; b = rgb.b;
        }
        else if (bppMode === "16") {
          const word = fileBuffer[currentByteIdx] | (fileBuffer[currentByteIdx + 1] << 8);
          r = ((word >> 11) & 0x1F) * 8;
          g = ((word >> 5) & 0x3F) * 4;
          b = (word & 0x1F) * 8;
        }
        else if (bppMode === "24") {
          r = fileBuffer[currentByteIdx];
          g = fileBuffer[currentByteIdx + 1];
          b = fileBuffer[currentByteIdx + 2];
        }
        else if (bppMode === "32") {
          r = fileBuffer[currentByteIdx];
          g = fileBuffer[currentByteIdx + 1];
          b = fileBuffer[currentByteIdx + 2];
          a = fileBuffer[currentByteIdx + 3];
        }
        else if (bppMode === "exe") {
          const byteVal = fileBuffer[currentByteIdx];
          if (byteVal === 0x00) { r = 0; g = 0; b = 0; }
          else if (byteVal === 0xFF) { r = 255; g = 255; b = 255; }
          else if (byteVal >= 0x20 && byteVal <= 0x7E) { r = 0; g = 220; b = 255; }
          else if (byteVal === 0xE9 || byteVal === 0xE8) { r = 255; g = 0; b = 0; }
          else { r = byteVal; g = (byteVal * 3) % 256; b = 255 - byteVal; }
        }

        drawPixelToCanvas(data, width, posX, posY, r, g, b, a);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  statusText.innerText = `Frame: ${width}x${height} px | Modo: ${isTileLayout ? `Tiles (${tileW}x${tileH})` : 'Bitmap Linear'} | Offset: 0x${startByteOffset.toString(16).toUpperCase()}`;
}

function drawPixelToCanvas(imgDataArr, canvasWidth, x, y, r, g, b, a = 255) {
  const idx = (y * canvasWidth + x) * 4;
  imgDataArr[idx] = r;
  imgDataArr[idx + 1] = g;
  imgDataArr[idx + 2] = b;
  imgDataArr[idx + 3] = a;
}

function hexToRgb(hex) {
  if (!hex) return { r: 0, g: 0, b: 0 };
  const bigint = parseInt(hex.replace("#", ""), 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

// Reprodutor de Áudio
document.getElementById("btnPlayAudio").addEventListener("click", () => playBinaryAudio(pauseOffset));
document.getElementById("btnPauseAudio").addEventListener("click", pauseBinaryAudio);
document.getElementById("btnStopAudio").addEventListener("click", stopBinaryAudio);

seekSlider.addEventListener("input", () => {
  if (!fileBuffer || audioDuration === 0) return;
  const seekPercent = parseFloat(seekSlider.value) / 100;
  pauseOffset = seekPercent * audioDuration;

  const currentByteOffset = getByteOffsetFromProgress();
  renderWaterfall(currentByteOffset);
  updateSeekUI(pauseOffset);

  if (currentSourceNode && !isPaused) {
    playBinaryAudio(pauseOffset);
  }
});

function getByteOffsetFromProgress() {
  if (!fileBuffer || audioDuration === 0) return 0;
  const progressPercent = parseFloat(seekSlider.value) / 100;
  return Math.floor(progressPercent * fileBuffer.length);
}

function prepareAudioDuration() {
  if (!fileBuffer) return;
  const currentSampleRate = parseInt(sampleRateInput.value) || 22050;
  const format = audioFormatSelect.value;
  const pcmSamples = decodeBinaryToPCM(fileBuffer, format);
  audioDuration = pcmSamples.length / currentSampleRate;
  totalTimeEl.innerText = formatTime(audioDuration);
}

function playBinaryAudio(offsetSeconds = 0) {
  if (!fileBuffer) return alert("Carregue um arquivo binário primeiro!");

  if (currentSourceNode) {
    currentSourceNode.onended = null;
    currentSourceNode.stop();
  }
  if (audioCtx) audioCtx.close();

  const currentSampleRate = parseInt(sampleRateInput.value) || 22050;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: currentSampleRate
  });

  const format = audioFormatSelect.value;
  const pcmSamples = decodeBinaryToPCM(fileBuffer, format);
  audioDuration = pcmSamples.length / currentSampleRate;

  const audioBuffer = audioCtx.createBuffer(1, pcmSamples.length, currentSampleRate);
  audioBuffer.getChannelData(0).set(pcmSamples);

  currentSourceNode = audioCtx.createBufferSource();
  currentSourceNode.buffer = audioBuffer;
  currentSourceNode.connect(audioCtx.destination);

  startTime = audioCtx.currentTime - offsetSeconds;
  pauseOffset = offsetSeconds;
  isPaused = false;

  currentSourceNode.onended = () => {
    if (!isPaused) stopBinaryAudio();
  };

  currentSourceNode.start(0, offsetSeconds);
  statusText.innerText = "▶ Reproduzindo...";

  updateSyncLoop();
}

function pauseBinaryAudio() {
  if (currentSourceNode && !isPaused) {
    isPaused = true;
    pauseOffset = audioCtx.currentTime - startTime;
    currentSourceNode.stop();
    currentSourceNode = null;

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    statusText.innerText = "⏸️ Pausado.";
  }
}

function stopBinaryAudio() {
  if (currentSourceNode) {
    currentSourceNode.onended = null;
    currentSourceNode.stop();
    currentSourceNode = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  isPaused = false;
  pauseOffset = 0;
  updateSeekUI(0);
  renderWaterfall(0);
  statusText.innerText = "⏹️ Parado.";
}

function updateSyncLoop() {
  if (!audioCtx || !currentSourceNode || isPaused) return;

  const elapsed = audioCtx.currentTime - startTime;
  if (elapsed <= audioDuration) {
    updateSeekUI(elapsed);
    const currentByteOffset = Math.floor((elapsed / audioDuration) * fileBuffer.length);
    renderWaterfall(currentByteOffset);

    animationFrameId = requestAnimationFrame(updateSyncLoop);
  } else {
    stopBinaryAudio();
  }
}

function updateSeekUI(elapsedSeconds) {
  const progressPercent = (elapsedSeconds / audioDuration) * 100 || 0;
  seekSlider.value = Math.min(100, progressPercent);
  currentTimeEl.innerText = formatTime(elapsedSeconds);

  if (fileBuffer) {
    const currentByte = Math.floor((elapsedSeconds / audioDuration) * fileBuffer.length) || 0;
    const hex = currentByte.toString(16).toUpperCase().padStart(6, '0');
    hexOffsetEl.innerText = `Offset: 0x${hex} (Byte: ${currentByte})`;
    
    if (document.activeElement !== manualOffsetInput) {
      manualOffsetInput.value = `0x${hex}`;
    }
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function decodeBinaryToPCM(buffer, format) {
  let samples = [];

  if (format === "pcm_u8") {
    for (let i = 0; i < buffer.length; i++) {
      samples.push((buffer[i] - 128) / 128);
    }
  }
  else if (format === "pcm_s8") {
    const signedBuffer = new Int8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let i = 0; i < signedBuffer.length; i++) {
      samples.push(signedBuffer[i] / 128.0);
    }
  }
  else if (format === "dpcm_nes") {
    let currentVal = 0;
    for (let i = 0; i < buffer.length; i++) {
      let b = buffer[i];
      for (let bit = 0; bit < 8; bit++) {
        if ((b >> bit) & 1) currentVal = Math.min(63, currentVal + 2);
        else currentVal = Math.max(0, Math.min(63, currentVal - 2));
        samples.push((currentVal - 32) / 32);
      }
    }
  } 
  else if (format === "dpcm_md") {
    let currentVal = 128;
    const stepTable = [-16, -9, -4, -1, 0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121];
    for (let i = 0; i < buffer.length; i++) {
      let highNibble = buffer[i] >> 4;
      let lowNibble = buffer[i] & 0x0F;
      currentVal = Math.max(0, Math.min(255, currentVal + stepTable[highNibble]));
      samples.push((currentVal - 128) / 128);
      currentVal = Math.max(0, Math.min(255, currentVal + stepTable[lowNibble]));
      samples.push((currentVal - 128) / 128);
    }
  }

  return new Float32Array(samples);
}

// EXPORTAÇÃO DE VÍDEO
const videoExportModal = document.getElementById("videoExportModal");
document.getElementById("menuExportVideo").addEventListener("click", () => {
  if (!fileBuffer) return alert("Carregue um arquivo antes de exportar!");
  videoExportModal.classList.remove("hidden");
});
document.getElementById("closeVideoModal").addEventListener("click", () => videoExportModal.classList.add("hidden"));

document.getElementById("btnStartRecordVideo").addEventListener("click", async () => {
  const exportFormat = document.getElementById("exportVideoFormat").value;
  const exportMode = document.getElementById("exportVideoMode").value;
  videoExportModal.classList.add("hidden");

  stopBinaryAudio();

  if (exportMode === "direct") {
    await exportVideoDirectOffline(exportFormat);
  } else {
    exportVideoRealtime(exportFormat);
  }
});

async function exportVideoDirectOffline(extensionFormat) {
  statusText.innerText = "⏳ Processando vídeo diretamente...";

  const sampleRate = parseInt(sampleRateInput.value) || 22050;
  const format = audioFormatSelect.value;
  const pcmSamples = decodeBinaryToPCM(fileBuffer, format);
  const totalDuration = pcmSamples.length / sampleRate;

  const tempCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  const audioDest = tempCtx.createMediaStreamDestination();

  const buffer = tempCtx.createBuffer(1, pcmSamples.length, sampleRate);
  buffer.getChannelData(0).set(pcmSamples);

  const src = tempCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioDest);

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDest.stream.getAudioTracks()
  ]);

  let mime = extensionFormat === "mp4" ? 'video/mp4' : 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

  recordedChunks = [];
  const recorder = new MediaRecorder(combinedStream, { mimeType: mime });

  recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  recorder.onstop = () => {
    downloadBlob(new Blob(recordedChunks, { type: mime }), `binary_waterfall_render.${extensionFormat}`);
    tempCtx.close();
    statusText.innerText = "✅ Vídeo exportado com sucesso!";
  };

  recorder.start();
  src.start(0);

  const fps = 30;
  const totalFrames = Math.floor(totalDuration * fps);
  
  for (let f = 0; f < totalFrames; f++) {
    const frameTime = f / fps;
    const progress = frameTime / totalDuration;
    const currentByteOffset = Math.floor(progress * fileBuffer.length);

    renderWaterfall(currentByteOffset);
    updateSeekUI(frameTime);

    await new Promise(r => setTimeout(r, 1000 / fps));
  }

  src.stop();
  recorder.stop();
}

function exportVideoRealtime(extensionFormat) {
  recordedChunks = [];

  const sampleRate = parseInt(sampleRateInput.value) || 22050;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  }

  const audioDest = audioCtx.createMediaStreamDestination();

  const format = audioFormatSelect.value;
  const pcmSamples = decodeBinaryToPCM(fileBuffer, format);
  audioDuration = pcmSamples.length / sampleRate;

  const audioBuffer = audioCtx.createBuffer(1, pcmSamples.length, sampleRate);
  audioBuffer.getChannelData(0).set(pcmSamples);

  currentSourceNode = audioCtx.createBufferSource();
  currentSourceNode.buffer = audioBuffer;
  currentSourceNode.connect(audioCtx.destination);
  currentSourceNode.connect(audioDest);

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDest.stream.getAudioTracks()
  ]);

  let mime = extensionFormat === "mp4" ? 'video/mp4' : 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

  mediaRecorder = new MediaRecorder(combinedStream, { mimeType: mime });
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    downloadBlob(new Blob(recordedChunks, { type: mime }), `waterfall_recording.${extensionFormat}`);
    statusText.innerText = "Gravação de vídeo concluída!";
  };

  startTime = audioCtx.currentTime - pauseOffset;
  currentSourceNode.start(0, pauseOffset);
  mediaRecorder.start();

  statusText.innerText = "🎥 Gravando vídeo e áudio...";
  updateSyncLoop();

  currentSourceNode.onended = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    stopBinaryAudio();
  };
}

// Modal Áudio
const audioExportModal = document.getElementById("audioExportModal");
document.getElementById("menuExportAudio").addEventListener("click", () => {
  if (!fileBuffer) return alert("Carregue um arquivo antes de exportar!");
  audioExportModal.classList.remove("hidden");
});
document.getElementById("closeAudioModal").addEventListener("click", () => audioExportModal.classList.add("hidden"));

document.getElementById("btnConfirmAudioExport").addEventListener("click", () => {
  const exportFormat = document.getElementById("exportAudioFormat").value;
  const sampleRate = parseInt(sampleRateInput.value) || 22050;
  const pcmSamples = decodeBinaryToPCM(fileBuffer, audioFormatSelect.value);

  if (exportFormat === "raw") {
    const rawBuffer = new Int8Array(pcmSamples.length);
    for (let i = 0; i < pcmSamples.length; i++) {
      rawBuffer[i] = Math.max(-128, Math.min(127, pcmSamples[i] * 127));
    }
    downloadBlob(new Blob([rawBuffer], { type: "application/octet-stream" }), `audio_export.raw`);
  } 
  else if (exportFormat === "wav") {
    const wavBlob = encodeWAV(pcmSamples, sampleRate);
    downloadBlob(wavBlob, `audio_export.wav`);
  } 
  else {
    const tempCtx = new AudioContext({ sampleRate });
    const dest = tempCtx.createMediaStreamDestination();
    const buffer = tempCtx.createBuffer(1, pcmSamples.length, sampleRate);
    buffer.getChannelData(0).set(pcmSamples);

    const src = tempCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);

    let mimeType = exportFormat === "mp3" ? "audio/webm;codecs=opus" : "audio/ogg;codecs=opus";
    const rec = new MediaRecorder(dest.stream);
    let chunks = [];

    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      downloadBlob(new Blob(chunks, { type: mimeType }), `audio_export.${exportFormat}`);
      tempCtx.close();
    };

    rec.start();
    src.start(0);
    src.onended = () => rec.stop();
  }

  audioExportModal.classList.add("hidden");
});

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Modal Sobre
const modalOverlay = document.getElementById("modalOverlay");
const menuAboutBtn = document.getElementById("menuAboutBtn");
const closeAboutModal = document.getElementById("closeAboutModal");
const btnOkAbout = document.getElementById("btnOkAbout");

function openModal() { modalOverlay.classList.remove("hidden"); }
function closeModal() { modalOverlay.classList.add("hidden"); }

if (menuAboutBtn) menuAboutBtn.addEventListener("click", openModal);
if (closeAboutModal) closeAboutModal.addEventListener("click", closeModal);
if (btnOkAbout) btnOkAbout.addEventListener("click", closeModal);