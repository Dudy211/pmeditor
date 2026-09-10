/**
 * track-system.js — 三层解耦变轨系统
 * 逻辑层 + 运动层 + 表现层
 */

class TrackSystem {
    constructor(initialCount = 3) {
        this.logicalCount = initialCount;
        // 运动轨道：logicalId -> MotionTrack
        this.motionTracks = new Map();
        // 变轨历史
        this.switchHistory = [];
        // 动画时长（秒）
        this.animDuration = 0.3;
        // 初始化
        this._initMotionTracks(initialCount, 0);
    }

    _initMotionTracks(count, currentTime) {
        this.motionTracks.clear();
        for (let i = 0; i < count; i++) {
            const x = this._getUniformX(i, count);
            this.motionTracks.set(i, {
                logicalId: i,
                currentX: x,
                targetX: x,
                startX: x,
                animating: false,
                animStartTime: 0,
                active: true,
            });
        }
    }

    _getUniformX(logicalId, count) {
        // 均匀分布在 0~1 范围内，轨道位于 (logicalId + 1) / (count + 1)
        return (logicalId + 1) / (count + 1);
    }

    // ========== 映射算法 ==========

    /**
     * 选择合并时的保留锚点
     * 规则：trigger必须保留，其余从右向左选，不够再从左补充
     */
    static selectAnchors(sourceCount, targetCount, triggerId) {
        const anchors = [triggerId];
        let right = sourceCount - 1;
        while (anchors.length < targetCount && right >= 0) {
            if (!anchors.includes(right)) anchors.push(right);
            right--;
        }
        let left = 0;
        while (anchors.length < targetCount && left < sourceCount) {
            if (!anchors.includes(left)) anchors.push(left);
            left++;
        }
        return anchors.sort((a, b) => a - b);
    }

    /**
     * 计算合并映射：oldId -> newId
     * 非锚点向最近锚点合并，距离相同"先左后右"
     */
    static computeMergeMap(sourceCount, targetCount, triggerId) {
        const anchors = TrackSystem.selectAnchors(sourceCount, targetCount, triggerId);
        const map = new Map();
        for (let oldId = 0; oldId < sourceCount; oldId++) {
            if (anchors.includes(oldId)) {
                map.set(oldId, anchors.indexOf(oldId));
            } else {
                let bestAnchor = anchors[0];
                let bestDist = Math.abs(oldId - bestAnchor);
                for (let i = 1; i < anchors.length; i++) {
                    const anchor = anchors[i];
                    const dist = Math.abs(oldId - anchor);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestAnchor = anchor;
                    } else if (dist === bestDist && anchor < bestAnchor) {
                        bestAnchor = anchor; // 先左后右
                    }
                }
                map.set(oldId, anchors.indexOf(bestAnchor));
            }
        }
        return { map, anchors };
    }

    /**
     * 计算拆分映射：newId -> sourceOldId
     * trigger作为分裂源，产生多个新逻辑ID
     */
    static computeSplitMap(sourceCount, targetCount, triggerId) {
        const map = new Map();
        let newId = 0;
        for (let oldId = 0; oldId < sourceCount; oldId++) {
            if (oldId === triggerId) {
                const splitCount = targetCount - sourceCount + 1;
                for (let i = 0; i < splitCount; i++) {
                    map.set(newId++, oldId);
                }
            } else {
                map.set(newId++, oldId);
            }
        }
        return map;
    }

    /**
     * 计算变轨后的音符转移映射
     * 返回 Map<oldLogicalId, newLogicalId>
     * 用于编辑器中调整被合并轨道的音符
     */
    static computeNoteTransferMap(sourceCount, targetCount, triggerId) {
        if (sourceCount > targetCount) {
            // 合并：被合并的旧轨道音符需要转移到新逻辑ID
            const { map } = TrackSystem.computeMergeMap(sourceCount, targetCount, triggerId);
            return map;
        } else if (sourceCount < targetCount) {
            // 拆分：旧逻辑ID可能映射到多个新逻辑ID
            // 但音符本身不需要转移，它们保持原逻辑ID
            // 只有新放置的音符才使用新的逻辑ID
            const splitMap = TrackSystem.computeSplitMap(sourceCount, targetCount, triggerId);
            // 构建 oldId -> newId 映射（取第一个匹配的新ID）
            const oldToNew = new Map();
            for (let oldId = 0; oldId < sourceCount; oldId++) {
                for (const [newId, srcOldId] of splitMap) {
                    if (srcOldId === oldId) {
                        oldToNew.set(oldId, newId);
                        break;
                    }
                }
            }
            return oldToNew;
        }
        // 不变
        const map = new Map();
        for (let i = 0; i < sourceCount; i++) map.set(i, i);
        return map;
    }

    // ========== 变轨触发 ==========

    triggerSwitch(sourceCount, targetCount, triggerLogicalId, currentTime) {
        const oldMotionTracks = new Map(this.motionTracks);
        let newToOld;

        if (sourceCount > targetCount) {
            const { anchors } = TrackSystem.computeMergeMap(sourceCount, targetCount, triggerLogicalId);
            newToOld = new Map();
            for (let newId = 0; newId < targetCount; newId++) {
                newToOld.set(newId, anchors[newId]);
            }
        } else {
            newToOld = TrackSystem.computeSplitMap(sourceCount, targetCount, triggerLogicalId);
        }

        const newMotionTracks = new Map();
        for (let newId = 0; newId < targetCount; newId++) {
            const sourceOldId = newToOld.get(newId);
            const sourceTrack = oldMotionTracks.get(sourceOldId);
            const startX = sourceTrack ? sourceTrack.currentX : this._getUniformX(newId, targetCount);

            newMotionTracks.set(newId, {
                logicalId: newId,
                currentX: startX,
                targetX: this._getUniformX(newId, targetCount),
                startX: startX,
                animating: true,
                animStartTime: currentTime,
                active: true,
            });
        }

        this.motionTracks = newMotionTracks;
        this.logicalCount = targetCount;

        this.switchHistory.push({
            time: currentTime,
            sourceCount,
            targetCount,
            triggerLogicalId,
            newToOld,
        });

        return { oldMotionTracks, newMotionTracks, newToOld };
    }

    // ========== 每帧更新 ==========

    update(currentTime) {
        for (const track of this.motionTracks.values()) {
            if (track.animating) {
                const elapsed = currentTime - track.animStartTime;
                let progress = Math.min(1, elapsed / this.animDuration);
                progress = 1 - Math.pow(1 - progress, 3); // easeOutCubic
                track.currentX = track.startX + (track.targetX - track.startX) * progress;
                if (elapsed >= this.animDuration) {
                    track.animating = false;
                    track.currentX = track.targetX;
                }
            }
        }
    }

    // ========== 查询接口 ==========

    getTrackX(logicalId) {
        const track = this.motionTracks.get(logicalId);
        return track ? track.currentX : 0.5;
    }

    getTrackCount() {
        return this.logicalCount;
    }

    getMotionTracks() {
        return Array.from(this.motionTracks.values());
    }

    isAnimating() {
        for (const track of this.motionTracks.values()) {
            if (track.animating) return true;
        }
        return false;
    }

    reset(initialCount = 3) {
        this.logicalCount = initialCount;
        this.motionTracks.clear();
        this.switchHistory = [];
        this._initMotionTracks(initialCount, 0);
    }
}

// 全局暴露
window.TrackSystem = TrackSystem;
