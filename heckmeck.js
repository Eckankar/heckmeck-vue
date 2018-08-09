(function () {
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
        },
        methods: {
            addPlayer: function () {
                this.players.push( {
                    name: this.playerName,
                    tiles: []
                } );
                this.playerName = '';
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
                this.takenDice = [];
                this.roll();
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
                    this.rolledDice.push( Math.floor(Math.random() * 6) + 1 );
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
                }
                this.grill.pop();

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
            }
        },
        computed: {
            currentValue: function () {
                return _.sum( _.map(this.takenDice, function (v) { return v == 6 ? 5 : v; }) );
            },
            wormTaken: function () {
                return this.hasTaken(6);
            },
            canStop: function () {
                if (this.hasRolled) return false;
                if (! this.wormTaken) return false;
                return this.pickWorm(false);
            },
            failedTurn: function () {
                var that = this;
                if (!this.hasRolled) return false;
                return ! _.find(this.rolledDice, function(v) { return that.canTake(v) });
            },
            currentPlayer: function () {
                return this.players[this.activePlayer];
            },
            gameOver: function () {
                return this.grill.length == 0;
            }
        }
    });
})();
