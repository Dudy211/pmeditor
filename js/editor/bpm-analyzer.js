/**
 * editor/bpm-analyzer.js — BPM 自动分析器 v7
 * 多窗口投票 + 子帧精度 Comb Filter Bank + 谐波加权
 */

const BPMAnalyzer = {
    async analyze(audioBuffer, onProgress) {
        if (!audioBuffer) throw new Error("未加载音频");
        const report = (p, msg) => { if (onProgress) onProgress(p, msg); };

        const sampleRate = audioBuffer.sampleRate;
        const data = audioBuffer.getChannelData(0);
        const duration = audioBuffer.duration;

        report(5, "降采样…");
        await this._yield();
        const ds = this._downsample(data, sampleRate, 11025);

        report(15, "计算包络…");
        await this._yield();
        const fullEnvelope = this._lowFreqEnvelope(ds, 11025);
        const frameRate = 11025 / 256;

        // 多窗口：取能量最高的 3 个 20 秒片段，分别分析后投票
        report(25, "多窗口分析…");
        await this._yield();
        const windowFrames = Math.floor(20 * frameRate);
        const windows = this._findTopWindows(fullEnvelope, windowFrames, 3);

        const allCandidates = [];
        for (let w = 0; w < windows.length; w++) {
            const envelope = fullEnvelope.slice(windows[w].start, windows[w].end);
            report(30 + w * 20, `窗口 ${w + 1}/3 节拍匹配…`);
            await this._yield();

            // 子帧精度 Comb Filter（步进 0.5 BPM）
            const scores = this._combFilterBank(envelope, frameRate);
            const peaks = this._findPeaksSubFrame(scores);
            allCandidates.push(...peaks);
        }

        report(90, "汇总投票…");
        await this._yield();
        const result = this._voteAndResolve(allCandidates);

        report(100, "完成");
        return Math.round(result);
    },

    _yield() {
        return new Promise(r => setTimeout(r, 0));
    },

    _downsample(samples, srcRate, dstRate) {
        const ratio = Math.floor(srcRate / dstRate);
        const outLen = Math.floor(samples.length / ratio);
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
            let sum = 0;
            const s = i * ratio;
            for (let j = 0; j < ratio; j++) sum += samples[s + j];
            out[i] = sum / ratio;
        }
        return out;
    },

    _lowFreqEnvelope(samples, sampleRate) {
        const frameSize = 512, hopSize = 256;
        const numFrames = Math.floor((samples.length - frameSize) / hopSize);
        const avgWindow = Math.floor(sampleRate / 250);
        const filtered = new Float32Array(samples.length);
        let winSum = 0;
        for (let i = 0; i < samples.length; i++) {
            winSum += samples[i];
            if (i >= avgWindow) winSum -= samples[i - avgWindow];
            filtered[i] = winSum / Math.min(i + 1, avgWindow);
        }

        const env = new Float32Array(numFrames);
        for (let f = 0; f < numFrames; f++) {
            let sum = 0;
            const s = f * hopSize;
            for (let i = 0; i < frameSize; i++) {
                const v = filtered[s + i];
                sum += v * v;
            }
            env[f] = Math.sqrt(sum / frameSize);
        }

        // 对数压缩动态范围，让强弱拍更均衡
        for (let i = 0; i < numFrames; i++) {
            env[i] = Math.log1p(env[i] * 10);
        }

        // 差分 + 平滑
        const diff = new Float32Array(numFrames);
        diff[0] = 0;
        for (let i = 1; i < numFrames; i++) {
            diff[i] = Math.max(0, env[i] - env[i - 1]);
        }
        const smooth = new Float32Array(numFrames);
        smooth[0] = diff[0]; smooth[numFrames - 1] = diff[numFrames - 1];
        for (let i = 1; i < numFrames - 1; i++) {
            smooth[i] = (diff[i - 1] + diff[i] + diff[i + 1]) / 3;
        }
        return smooth;
    },

    /**
     * 找能量最高的 N 个不重叠窗口
     */
    _findTopWindows(envelope, windowFrames, count) {
        const windows = [];
        const minGap = Math.floor(windowFrames * 0.5); // 窗口间至少重叠50%

        for (let n = 0; n < count; n++) {
            let bestStart = 0, bestSum = -1;
            let winSum = 0;

            // 初始
            for (let i = 0; i < windowFrames && i < envelope.length; i++) {
                winSum += envelope[i];
            }
            bestSum = winSum;

            // 滑动，跳过已被选中的区域
            for (let i = windowFrames; i < envelope.length; i++) {
                winSum += envelope[i];
                winSum -= envelope[i - windowFrames];
                const start = i - windowFrames + 1;

                // 检查是否与已有窗口太接近
                let tooClose = false;
                for (const w of windows) {
                    if (Math.abs(start - w.start) < minGap) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;

                if (winSum > bestSum) {
                    bestSum = winSum;
                    bestStart = start;
                }
            }

            if (bestSum < 0) break;
            windows.push({ start: bestStart, end: bestStart + windowFrames });
        }

        // 保底：如果没找到足够的，补全首歌
        while (windows.length < count) {
            windows.push({ start: 0, end: envelope.length });
        }

        return windows;
    },

    /**
     * Comb Filter Bank：子帧精度（0.5 BPM 步进）+ 32 相位 + 谐波加权
     */
    _combFilterBank(envelope, frameRate) {
        const N = envelope.length;
        const scores = {};
        const phases = 32;

        // 50-220 BPM，步进 0.5
        for (let bpm100 = 5000; bpm100 <= 22000; bpm100 += 50) {
            const bpm = bpm100 / 100;
            const beatInterval = (60 / bpm) * frameRate;
            let bestScore = -Infinity;

            for (let phase = 0; phase < phases; phase++) {
                const offset = (phase / phases) * beatInterval;
                let sum1x = 0, sum2x = 0, sum4x = 0;
                let cnt1x = 0, cnt2x = 0, cnt4x = 0;

                let pos = offset;
                while (pos < N) {
                    const idx = Math.round(pos);
                    if (idx >= 0 && idx < N) {
                        sum1x += envelope[idx];
                        cnt1x++;
                    }
                    pos += beatInterval;
                }

                // 2x 谐波（半拍）
                pos = offset;
                const halfInterval = beatInterval / 2;
                while (pos < N) {
                    const idx = Math.round(pos);
                    if (idx >= 0 && idx < N) {
                        sum2x += envelope[idx];
                        cnt2x++;
                    }
                    pos += halfInterval;
                }

                // 4x 谐波（四分之一拍）
                pos = offset;
                const quarterInterval = beatInterval / 4;
                while (pos < N) {
                    const idx = Math.round(pos);
                    if (idx >= 0 && idx < N) {
                        sum4x += envelope[idx];
                        cnt4x++;
                    }
                    pos += quarterInterval;
                }

                let score = 0;
                if (cnt1x > 0) score += (sum1x / cnt1x) * 1.0;
                if (cnt2x > 0) score += (sum2x / cnt2x) * 0.5;
                if (cnt4x > 0) score += (sum4x / cnt4x) * 0.25;

                if (score > bestScore) bestScore = score;
            }

            scores[bpm] = bestScore;
        }

        return scores;
    },

    /**
     * 子帧精度峰值检测：抛物线插值
     */
    _findPeaksSubFrame(scores) {
        // 先 1-BPM 步进找粗峰值
        const coarse = {};
        for (let bpm = 50; bpm <= 220; bpm++) {
            coarse[bpm] = (
                (scores[bpm - 1] || 0) * 0.2 +
                (scores[bpm]     || 0) * 0.6 +
                (scores[bpm + 1] || 0) * 0.2
            );
        }

        const peaks = [];
        for (let bpm = 51; bpm <= 219; bpm++) {
            const v = coarse[bpm];
            if (v > coarse[bpm - 1] && v > coarse[bpm + 1] && v > 0) {
                // 抛物线插值找精确峰值位置
                const y1 = coarse[bpm - 1], y2 = coarse[bpm], y3 = coarse[bpm + 1];
                const denom = y1 - 2 * y2 + y3;
                let preciseBPM = bpm;
                if (Math.abs(denom) > 0.0001) {
                    preciseBPM = bpm + 0.5 * (y1 - y3) / denom;
                }
                peaks.push({ bpm: preciseBPM, score: v });
            }
        }

        peaks.sort((a, b) => b.score - a.score);
        return peaks.slice(0, 8);
    },

    /**
     * 多窗口候选汇总 + 倍速修正 + 先验
     */
    _voteAndResolve(allCandidates) {
        // 汇总相同 BPM（±1 视为相同）
        const merged = {};
        for (const c of allCandidates) {
            const key = Math.round(c.bpm);
            if (!merged[key]) {
                merged[key] = { bpm: c.bpm, score: 0, count: 0 };
            }
            merged[key].score += c.score;
            merged[key].count++;
        }

        // 平均 + 窗口数加权
        const list = Object.values(merged).map(m => ({
            bpm: m.bpm,
            score: m.score / m.count * (1 + m.count * 0.3)
        }));

        // 倍速扩展
        const expanded = [];
        for (const c of list) {
            expanded.push({ bpm: c.bpm, score: c.score });
            if (c.bpm / 2 >= 50) expanded.push({ bpm: c.bpm / 2, score: c.score * 0.8 });
            if (c.bpm * 2 <= 220) expanded.push({ bpm: c.bpm * 2, score: c.score * 0.8 });
            if (c.bpm / 3 >= 50) expanded.push({ bpm: c.bpm / 3, score: c.score * 0.35 });
            if (c.bpm * 3 <= 220) expanded.push({ bpm: c.bpm * 3, score: c.score * 0.35 });
        }

        // 先验
        for (const c of expanded) {
            let score = c.score;
            if (c.bpm >= 128 && c.bpm <= 160) score *= 1.6;      // 音游核心
            else if (c.bpm >= 100 && c.bpm <= 170) score *= 1.3;  // 流行/电子
            else if (c.bpm >= 80 && c.bpm <= 180) score *= 1.1;
            else if (c.bpm < 60 || c.bpm > 190) score *= 0.35;
            c.finalScore = score;
        }

        expanded.sort((a, b) => b.finalScore - a.finalScore);
        return expanded[0].bpm;
    }
};
