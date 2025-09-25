class AIPicker {
    constructor(modelData) {
        this.modelData = modelData;
        this.inputSize = modelData.architecture[0];
        this.numActions = modelData.architecture[modelData.architecture.length - 1];
        this.maxPlayers = 8; // Should match training config
        this.tileMin = 21;
        this.tileMax = 36;
        
        // Check if debug mode is enabled
        const urlParams = new URLSearchParams(window.location.search);
        this.debug = urlParams.get('debug') === '1';

        // Explicit fold action index (matches training script: index 8)
        this.FOLD_ACTION = 8;
    }

    encodeState(stateDict, numPlayers) {
        const vec = new Float32Array(this.inputSize);
        let idx = 0;

        // 1. Available tiles (16)
        for (const tile of stateDict.availableTiles) {
            if (tile >= this.tileMin && tile <= this.tileMax) {
                vec[tile - this.tileMin] = 1.0;
            }
        }
        idx += 16;

        // 2. Top tile per player (top-of-stack = first element)
        for (let i = 0; i < this.maxPlayers; i++) {
            const playerTiles = stateDict.playerTiles[i] || [];
            if (playerTiles.length > 0) {
                const topTile = playerTiles[0]; // match training encoder
                if (topTile >= this.tileMin && topTile <= this.tileMax) {
                    vec[idx + topTile - this.tileMin] = 1.0;
                }
            }
            idx += 16;
        }

        // 3. Current dice roll
        const maxDice = 8.0;
        for (const die of stateDict.currentRoll) {
            vec[idx + die - 1] += 1.0 / maxDice;
        }
        idx += 6;

        // 4. Kept dice
        for (const die of stateDict.keptDice) {
            vec[idx + die - 1] += 1.0 / maxDice;
        }
        idx += 6;

        // 5. Provisional score
        const maxScore = 50.0;
        vec[idx] = Math.min(stateDict.provisionalScore / maxScore, 1.0);
        idx += 1;

        // 6. Current player one-hot (current player is always at index 0 atm, as that's what the model expects)
        vec[idx] = 1.0; // current player is always at index 0
        idx += this.maxPlayers;

        // 7. Can steal flag
        let canSteal = 0;
        const provScore = stateDict.provisionalScore;
        for (let i = 0; i < numPlayers; i++) {
            if (i !== stateDict.currentPlayerIdx) {
                const playerTiles = stateDict.playerTiles[i] || [];
                if (playerTiles.length > 0 && Math.max(...playerTiles) === provScore) {
                    canSteal = 1;
                    break;
                }
            }
        }
        vec[idx] = canSteal;
        idx += 1;

        // 8. Additional features
        vec[idx] = stateDict.currentRoll.length / 8.0; idx += 1;          // dice left
        vec[idx] = stateDict.keptDice.length / 8.0; idx += 1;             // turn progress
        vec[idx] = stateDict.hasRolled ? 1.0 : 0.0;                       // hasRolled (was missing)

        return vec;
    }

    getLegalActions(stateDict) {
        const actions = [];
        const hasRolled = stateDict.hasRolled;
        const currentRoll = stateDict.currentRoll;
        const keptDice = stateDict.keptDice;

        if (hasRolled) {
            const uniqueRolled = [...new Set(currentRoll)];
            for (const die of uniqueRolled) {
                if (!keptDice.includes(die)) actions.push(die - 1);
            }
        }

        // Stop only after a keep and only if tile available or a top-of-stack steal is possible
        if (!hasRolled && keptDice.includes(6)) {
            const score = stateDict.provisionalScore;
            const available = stateDict.availableTiles;
            if (available.some(t => t <= score)) {
                actions.push(6);
            } else {
                for (let i = 0; i < stateDict.playerTiles.length; i++) {
                    if (i === stateDict.currentPlayerIdx) continue;
                    const tiles = stateDict.playerTiles[i] || [];
                    if (tiles.length && tiles[0] === score) { // top-of-stack only
                        actions.push(6);
                        break;
                    }
                }
            }
        }

        if (!hasRolled && currentRoll.length > 0 && keptDice.length > 0) {
            actions.push(7);
        }

        if (actions.length === 0) {
            actions.push(this.FOLD_ACTION);
        }

        return actions;
    }

    forward(input) {
        const x = Array.isArray(input) ? new Float32Array(input) : input;

        const inSize = this.inputSize;
        const h1 = this.modelData.architecture[1]; // 256
        const h2 = this.modelData.architecture[2]; // 128
        const outSize = this.numActions;           // 9

        // Layer 1
        let out1 = new Float32Array(h1);
        for (let i = 0; i < h1; i++) {
            let sum = this.modelData.biases[0][i];
            const wRow = this.modelData.weights[0][i]; // length = inSize
            for (let j = 0; j < inSize; j++) {
                sum += x[j] * wRow[j];
            }
            out1[i] = Math.max(0, sum);
        }

        // Layer 2
        let out2 = new Float32Array(h2);
        for (let i = 0; i < h2; i++) {
            let sum = this.modelData.biases[1][i];
            const wRow = this.modelData.weights[1][i]; // length = h1
            for (let j = 0; j < h1; j++) {
                sum += out1[j] * wRow[j];
            }
            out2[i] = Math.max(0, sum);
        }

        // Output layer
        let out3 = new Float32Array(outSize);
        for (let i = 0; i < outSize; i++) {
            let sum = this.modelData.biases[2][i];
            const wRow = this.modelData.weights[2][i]; // length = h2
            for (let j = 0; j < h2; j++) {
                sum += out2[j] * wRow[j];
            }
            out3[i] = sum;
        }

        return out3;
    }

    selectAction(stateDict, numPlayers) {
        // Rotate current player to index 0 for the model
        let rotatedState = { ...stateDict };
        const idx = stateDict.currentPlayerIdx;
        if (idx !== 0) {
            // Rotate playerTiles so current player is at index 0
            rotatedState.playerTiles = [
                ...stateDict.playerTiles.slice(idx),
                ...stateDict.playerTiles.slice(0, idx)
            ];
            rotatedState.currentPlayerIdx = 0;
        }

        // Encode state
        const stateVec = this.encodeState(rotatedState, numPlayers);

        // Get legal actions
        const legalActions = this.getLegalActions(rotatedState);

        // Bust / no-legal-action handling -> return Fold instead of -1
        if (legalActions.length === 0) {
            if (this.debug) {
                console.log(
                    'AI Decision (No legal actions): Returning Fold action\n' +
                    `  Current Player: ${stateDict.currentPlayerIdx}\n` +
                    `  Provisional Score: ${stateDict.provisionalScore}\n`
                );
            }
            return this.FOLD_ACTION;
        }

        // Get Q-values
        const qValues = this.forward(stateVec);

        // Find best legal action
        let bestAction = -1;
        let bestValue = -Infinity;
        for (const action of legalActions) {
            if (qValues[action] > bestValue) {
                bestValue = qValues[action];
                bestAction = action;
            }
        }

        // Fallback (should not trigger unless all qValues are NaN)
        if (bestAction === -1) {
            bestAction = this.FOLD_ACTION;
        }

        // Debug logging
        if (this.debug) {
            const actionNames = [
                "Keep 1", "Keep 2", "Keep 3", "Keep 4", "Keep 5", "Keep 6",
                "Stop", "Roll", "Fold"
            ];
            const actionDesc = actionNames[bestAction] || `Action ${bestAction}`;
            const playerTilesStr = rotatedState.playerTiles.map((tiles, i) =>
                `P${i}${i === rotatedState.currentPlayerIdx ? '*' : ''}: [${tiles.join(',')}]`
            ).join(' | ');
            const debugMsg =
                `AI Decision:\n` +
                `  Current Player: ${rotatedState.currentPlayerIdx}\n` +
                `  Player Tiles: ${playerTilesStr}\n` +
                `  Available Tiles: [${rotatedState.availableTiles.join(',')}] \n` +
                `  Kept Dice: [${rotatedState.keptDice.join(',')}] \n` +
                `  Current Roll: [${rotatedState.currentRoll.join(',')}] \n` +
                `  Provisional Score: ${rotatedState.provisionalScore}\n` +
                `  Legal Actions: ${legalActions.map(a => actionNames[a] || a).join(', ')}\n` +
                `  Chosen Action: ${actionDesc}\n` +
                `  Q-Values: ${legalActions.map(a => {
                    const n = actionNames[a] || a;
                    return `${n}: ${qValues[a].toFixed(2)}`;
                }).join(', ')}\n`;
            console.log(debugMsg);
        }

        return bestAction;
    }
}

// Load model and create picker
let aiPicker = null;

fetch('game-ai-model.json')
    .then(response => response.json())
    .then(modelData => {
        aiPicker = new AIPicker(modelData);
        console.log(`AI model loaded successfully (Model name: ${modelData.name || 'N/A'})`);
    })
    .catch(error => {
        console.error('Failed to load AI model:', error);
    });

// Export function for use in main app
function getAIPicker() {
    return aiPicker;
}

// Make it available globally
window.getAIPicker = getAIPicker;
