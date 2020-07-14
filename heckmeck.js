(function () {
    function randomBotName() {
        var prefixes = ["Ch", "K", "M", "Tr", "Sp"];
        var middles = ["a", "e", "u", "i", "o"];
        var ends = ["ft", "ht", "ck", "son", "n"];

        return _.sample(prefixes) + _.sample(middles) + _.sample(ends);
    }

    function dieRoll() {
         return Math.floor(Math.random() * 6) + 1;
    }

    var sim_cache = {};
    const SIM_CNT = 20;
    function simulateChoices(dice, taken) {
        var cache_key = _.sortBy(dice).join("_") + "--" + _.sortBy(taken).join("_");
        if (sim_cache[cache_key]) return sim_cache[cache_key];

        var choices = _.groupBy(dice);
        var best_die;
        var best_outcome = 0;
        var best_failures;
        _.forEach(choices, function (rolled, die) {
            if (_.find(taken, function (v) { return die == v })) {
                // We've already taken this die
            } else {
                var new_taken = _.concat(taken, rolled);
                var remainder = dice.length - rolled.length;
                var failures = 0;

                var outcome = 0;
                for (var i = 0; i < SIM_CNT; i++) {
                    var roll = _.times(remainder, dieRoll);

                    var res = simulateChoices(roll, new_taken);
                    outcome += ( die == 6 ? 5 : die ) * rolled.length + res.expected;
                    if (! res.best_die) failures += 1;
                }
                outcome /= SIM_CNT;
                if (outcome > best_outcome) {
                    best_die = die;
                    best_outcome = outcome;
                    best_failures = failures / SIM_CNT;
                }
            }
        });

        sim_cache[cache_key] = { "expected": best_outcome, "best_die": best_die, "failures": best_failures };
        return sim_cache[cache_key];
    }

    Vue.component('grubs', {
        template: "#grubs-template",
        props: ['piece']
    });
    Vue.component('worm-piece', {
        template: '#worm-piece-template',
        props: ['piece']
    });
    Vue.component('die', {
        template: '#die-template',
        props: ['value']
    });

    var app = new Vue({
        el: '#app',
        data: {
            state: 'input_players',
            players: [],
            grill: [],
            activePlayer: -1,
            takenDice: [],
            playerName: '',
            hasRolled: true,
            ai_data: {},
        },
        methods: {
            addPlayer: function () {
                this.players.push( {
                    name: this.playerName,
                    tiles: [],
                    type: 'human'
                } );
                this.playerName = '';
            },
            addAI: function () {
                this.players.push( {
                    name: randomBotName(),
                    tiles: [],
                    type: 'ai',
                } );
            },
            resetGame: function () {
                this.players = _.shuffle(this.players);
                var i = 0;
                this.players.forEach( function (p) {
                    p.tiles = [];
                    p.id = i++;
                } );
                this.activePlayer = 0;

                this.grill = []
                for (var i = 21; i <= 36; i++) {
                    this.grill.push({ number: i, value: Math.ceil((i-20)/4) });
                }

                this.newRound();
            },
            startAgain: function () {
                this.players = [];
                this.state = 'input_players';
            },
            newRound: function () {
                this.ai_data = {};
                this.takenDice = [];
                this.roll();

                console.log(this.activePlayer);
                if (this.currentPlayer.type == 'ai' && ! this.gameOver) {
                    this.takeAIStep();
                }
            },
            nextTurn: function () {
                var that = this;

                this.activePlayer = (this.activePlayer + 1) % this.players.length;
                this.newRound();

                if (this.gameOver) {
                    this.players = _.sortBy( this.players, function (p) { - that.getPoints(p) });
                    this.state = 'game_over';
                }
            },
            roll: function () {
                this.rolledDice = [];
                for (var i = 0; i < 8-this.takenDice.length; i++) {
                    this.rolledDice.push( dieRoll() );
                }
                this.rolledDice = _.sortBy(this.rolledDice);
                this.hasRolled = true;
            },
            startGame: function () {
                this.resetGame();
                this.state = 'game';
            },
            hasTaken: function (v) {
                return _.find(this.takenDice, function (e) { return e == v; });
            },
            canTake: function (v) {
                return this.hasRolled && ! this.hasTaken(v);
            },
            playerPickDie: function (v) {
                if (! this.playerTurn) return;
                return this.pickDie(v);
            },
            pickDie: function (v) {
                if (! this.canTake(v)) return;

                var part = _.partition(this.rolledDice, function (e) { return e == v; });
                if (part[0].length == 0) return;


                this.rolledDice = part[1];
                this.takenDice = _.sortBy( this.takenDice.concat(part[0]) );
                this.hasRolled = false;
            },
            stopTurn: function () {
                var worm = this.pickWorm(true);
                this.currentPlayer.tiles.unshift(worm);
                this.nextTurn();
            },
            failTurn: function () {
                if (this.currentPlayer.tiles.length > 0) {
                    var worm = this.currentPlayer.tiles.shift();
                    this.grill.push(worm);
                    this.grill = _.sortBy(this.grill, function (w) { return w.number; });

                    // Only remove the topmost worm from the grill if it wasn't just returned.
                    if (this.grill[this.grill.length-1].number !== worm.number) {
                        this.grill.pop();
                    }
                }

                this.nextTurn();
            },
            getPoints: function (player) {
                return _.sum( _.map(player.tiles, function (t) { return t.value; }) );
            },
            pickWorm: function (remove) {
                var worm;
                var v = this.currentValue;

                for (var i = 0; i < this.players.length; i++) {
                    if (i == this.activePlayer) continue;
                    var player = this.players[i];
                    if (player.tiles.length >= 1 && player.tiles[0].number == v) {
                        worm = player.tiles[0];
                        if (remove) player.tiles.shift();
                        return worm;
                    }
                }

                var grillWorms = _.partition(this.grill, function (e) { return e.number <= v; });
                if (grillWorms[0].length > 0) {
                    worm = grillWorms[0][grillWorms[0].length-1];
                    if (remove) grillWorms[0].pop();
                    this.grill = grillWorms[0].concat( grillWorms[1] );
                    return worm;
                }

                return worm;
            },
            takeAIStep: function () {
                var that = this;
                var res = simulateChoices(this.rolledDice, this.takenDice);
                if (res.best_die) {
                    this.pickDie(res.best_die);
                    this.roll();
                    console.log(res.best_die, this.rolledDice, this.takenDice, res.failures);
                    if (res.failures < 0.5 || ! this.wormTaken()) {
                        setTimeout(function () { that.takeAIStep(); }, 1000);
                    } else {
                        if (this.pickWorm(false)) {
                            setTimeout(function () { that.stopTurn(); }, 1000);
                        } else {
                            setTimeout(function () { that.failTurn(); }, 1000);
                        }
                    }
                } else {
                    setTimeout(function () { that.failTurn(); }, 1000);
                }
            },
        },
        computed: {
            currentValue: function () {
                return _.sum( _.map(this.takenDice, function (v) { return v == 6 ? 5 : v; }) );
            },
            wormTaken: function () {
                return this.hasTaken(6);
            },
            canStop: function () {
                if (! this.playerTurn) return false;
                if (this.hasRolled) return false;
                if (! this.wormTaken) return false;
                return this.pickWorm(false);
            },
            failedTurn: function () {
                var that = this;
                if (! this.playerTurn) return false;

                if (this.rolledDice.length == 0 && !this.wormTaken) return true;

                if (!this.hasRolled) return false;
                return ! _.find(this.rolledDice, function(v) { return that.canTake(v) });
            },
            currentPlayer: function () {
                return this.players[this.activePlayer];
            },
            gameOver: function () {
                return this.grill.length == 0;
            },
            canRoll: function () {
                return this.playerTurn && ! this.hasRolled && this.rolledDice.length > 0;
            },
            playerTurn: function () {
                return this.currentPlayer.type == 'human';
            }
        }
    });
})();
