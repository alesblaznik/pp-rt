var _ = require('underscore');

var Idea = function (ideaId, title, description) {
    this.snapshot = null;
    this.eventsSinceSnapshot = [];
    this.uncommittedEvents = [];

    this.ideaId = ideaId;
    this.title = title;
    this.description = description;
    this.tags = [];

    var createIdea = function (title, description) {
        var idea = new Idea(title, description);
        idea.apply({
            "type": "IdeaWasCreated",
            "data": {
                "ideaId": 123,
                "account_id": 1,
                "user_id": 2,
                "project_id": 1,
                "title": "My new idea",
                "description": "Description of an Idea"
            },
            "meta": {
                "account_id": 123,
                "user_id": 1
            }
        });

        return idea;
    }

    this.changeTitle = function (newTitle) {
        this.createSnapshot();

        this.apply({
            "type": "IdeaTitleWasChanged",
            "data": {
                "ideaId": this.ideaId,
                "title": newTitle
            },
            // Generate UUID insted
            "correlationId": "my-ref-title" + newTitle
        });
    };

    this.addTag = function (tagId) {
        this.createSnapshot();

        this.apply({
            "type": "TagWasAddedToAnIdea",
            "data": {
                "ideaId": this.ideaId,
                "tagId": tagId
            },
            // Generate UUID instead
            "correlationId": "my-ref-" + tagId
        });
    }

    this.applyIdeaWasCreated = function (event) {
        this.ideaId = event.data.ideaId;
        this.title = event.data.title;
        this.description = event.data.description;

        this.recordThat(event);
    };

    this.applyIdeaTitleWasChanged = function (event) {
        this.title = event.data.title;

        this.recordThat(event);
    };

    this.applyTagWasAddedToAnIdea = function (event) {
        this.tags.push(event.data.tagId);

        this.recordThat(event);
    };

    this.apply = function (event) {
        var functionName = 'apply' + event.type;
        this[functionName](event);

        this.uncommittedEvents.push(event);
    };

    this.initializeState = function (stream, fromSnapshot) {
        for (si in stream) {
            var event = stream[si];

            // Remove event from uncommittedEvents - now we got response from server
            // that our event was processed (if correlationId matches)
            if (!fromSnapshot) {
                this.uncommittedEvents = _.reject(this.uncommittedEvents, function (ue) { 
                    return ue.correlationId == event.correlationId;
                });
            }

            var functionName = 'apply' + event.type;
            this[functionName](event);

            if (!fromSnapshot && 0 == this.uncommittedEvents.length) {
                this.allEventsCommited();
            }
        }
    };

    this.applyFailedThatIdeaTitleWasChanged = function (event) {
        this.processFailedEvent(event);
    };

    this.applyFailedThatTagWasAddedToAnIdea = function (event) {
        this.processFailedEvent(event);
    };

    this.processFailedEvent = function (event) {
        // Remove event from eventStore, since it failed
        this.eventsSinceSnapshot = _.reject(this.eventsSinceSnapshot, function (ue) {
            return ue.correlationId == event.correlationId;
        });

        // Reconstruct from snapshot
        this.reconstructFromSnapshot();
        this.initializeState(this.eventsSinceSnapshot, true);
    };

    this.toString = function() {
        return {
            ideaId: this.ideaId,
            title: this.title,
            description: this.description,
            tags: this.tags
        };
    };


    /** Tracking changes **/
    this.createSnapshot = function () {
        if (null == this.snapshot) {
            // Create snapshot of currentVersion
            this.snapshot = {
                id: _.clone(this.ideaId),
                title: _.clone(this.title),
                description: _.clone(this.description),
                tags: _.clone(this.tags)
            };

            this.eventsSinceSnapshot = [];
        }
    };

    this.reconstructFromSnapshot = function () {
        this.ideaId = this.snapshot.ideaId;
        this.title = this.snapshot.title;
        this.description = this.snapshot.description;
        this.tags = _.clone(this.snapshot.tags);
    };

    this.allEventsCommited = function () {
        if (this.snapshot) {
            this.reconstructFromSnapshot();
            this.snapshot = null;
            this.eventsSinceSnapshot = [];
        }
    };

    this.recordThat = function (e) {
        if (null != this.snapshot) {
            this.eventsSinceSnapshot.push(e);
        }
    };
}

var IdeaInMemoryRepository = function (ideas) {

    this.ideas = ideas;

    this.find = function (ideaId) {
        return _.find(this.ideas, function(idea) { return idea.ideaId == ideaId; });
    };
}

var IdeaRepositoryFactory = {
    createInMemoryRepository: function (ideas) {
        return new IdeaInMemoryRepository(ideas);
    }
};


// Test cases
var chai = require("chai");
var assert = chai.assert;
var expect = chai.expect;
describe('Idea', function(){

    beforeEach(function() {
        ideaRepository = IdeaRepositoryFactory.createInMemoryRepository([
            new Idea(123, "1st idea")
        ]);
    });


    describe('#initializeState', function () {
        it('applies server events', function () {
            var idea = ideaRepository.find(123);
            var serverEvents = [
                {"type": "IdeaTitleWasChanged", "data": {"title": "Another title"}},
                {"type": "IdeaTitleWasChanged", "data": {"title": "Last title"}}
            ];
            idea.initializeState(serverEvents);

            expect(idea.title).to.equal("Last title");
        });


    });

    describe("#changeTitle", function () {
        it('creates snapshot of an idea', function () {
            var idea = ideaRepository.find(123);
            idea.changeTitle('Awesome idea');

            expect(idea.snapshot).to.not.be.a('null');
        });

        it('starts storing new events', function () {
            // .. so if something fails, we can reconstruct idea

            var idea = ideaRepository.find(123);
            idea.changeTitle('Awesome idea');

            // Now some server events come in
            var serverEvents = [
                {"type": "IdeaTitleWasChanged", "data": {"title": "Title from server"}}
            ];
            idea.initializeState(serverEvents);

            // And some more user's events
            idea.addTag(1);

            // 1. idea.changeTitle
            // 2. event from server
            // 3. idea.addTag
            assert.lengthOf(idea.eventsSinceSnapshot, 3);
        });

    });

    describe('#uncommittedEvents', function () {
        it('contains events not yet confirmed by server', function () {
            idea = ideaRepository.find(123);
            idea.changeTitle('New title');
            idea.addTag(1234);

            assert.lengthOf(idea.uncommittedEvents, 2);
            expect(idea.uncommittedEvents[0].type).to.be.equal('IdeaTitleWasChanged');
            expect(idea.uncommittedEvents[1].type).to.be.equal('TagWasAddedToAnIdea');
        });

        it('is truncated when events are commited from server', function () {
            idea = ideaRepository.find(123);
            idea.changeTitle('New title');
            idea.addTag(1234);

            // Just to see behaviour
            assert.lengthOf(idea.uncommittedEvents, 2);

            idea.initializeState(idea.uncommittedEvents);
            assert.lengthOf(idea.uncommittedEvents, 0);
        });

        it('is truncated when events are rejected from server', function () {
            idea = ideaRepository.find(123);
            idea.changeTitle('This title is completely off');

            // Just to show behaviour
            assert.lengthOf(idea.uncommittedEvents, 1);

            var correlationId = idea.uncommittedEvents[0].correlationId;
            // We fake response from server

            idea.initializeState([
                {'type': 'FailedThatIdeaTitleWasChanged', 'correlationId': correlationId}
            ]);

            assert.lengthOf(idea.uncommittedEvents, 0);
        });
    });

    /**
     *  Checking if state remains consistent
     */
    describe('idea state', function() {
        it('is immediately updated when updates come from server', function () {
            idea = ideaRepository.find(123);

            idea.initializeState([
                {'type': 'TagWasAddedToAnIdea', 'data': {'ideaId': 123, 'tagId': 1}},
                {'type': 'IdeaTitleWasChanged', 'data': {'ideaId': 123, 'title': 'Check this one'}},
                {'type': 'TagWasAddedToAnIdea', 'data': {'ideaId': 123, 'tagId': 3}},
            ]);

            expect(idea.title).to.be.equal('Check this one');
            expect(idea.tags).to.contains(1);
            expect(idea.tags).to.contains(3);
        });

        it('is immediately updated when user makes some changes', function () {
            idea = ideaRepository.find(123);

            idea.changeTitle('Trying this inline editing');
            idea.addTag(9);

            expect(idea.title).to.be.equal('Trying this inline editing');
            expect(idea.tags).to.contains(9);
        });

        it('is reverted to previous state if user event fails', function() {
            idea = ideaRepository.find(123);

            // Event from server - just to set idea.title we know about
            idea.initializeState([
                {'type': 'IdeaTitleWasChanged', 'data': {'title': 'Try to reconstruct me', 'ideaId': 123}}
            ]);


            idea.changeTitle('This title will fail, wuhahah!!!');
            // Check that we actually changed the title - just to show behaviour
            expect(idea.title).to.be.equal('This title will fail, wuhahah!!!');

            var correlationId = idea.uncommittedEvents[0].correlationId;
            // There we should send event to server

            var serverResponseOnEvilTitle = {
                'type': 'FailedThatIdeaTitleWasChanged',
                'correlationId': correlationId
            };

            // Apply server event
            idea.initializeState([serverResponseOnEvilTitle]);
            expect(idea.title).to.be.equal('Try to reconstruct me');
        });

        it('is calculated quickly from very lot of events', function () {
            idea = ideaRepository.find(123);

            var eventsFromServer = [];
            for (var i=0; i<15000; i++) {
                eventsFromServer.push({'type': 'IdeaTitleWasChanged', 'data': {'title': 'Whatever - even not needed to be faked', 'ideaId': 123}});
            }

            idea.initializeState(eventsFromServer);
        });

        it('is calculated quickly even though I have some uncommited events', function () {
            idea = ideaRepository.find(123);

            // We create uncommited event here
            // + we now track all events for this idea in array
            idea.changeTitle('I am wating a long time you know ;)');
            correlationId = idea.uncommittedEvents[0].correlationId;

            var eventsFromServer = [];
            for (var i=0; i<14999; i++) {
                eventsFromServer.push({'type': 'IdeaTitleWasChanged', 'data': {'title': 'Whatever - even not needed to be faked', 'ideaId': 123}});
            }

            // Add one event to check if it works correctly
            eventsFromServer.push({'type': 'IdeaTitleWasChanged', 'data': {'title': 'Lets check this one', 'ideaId': 123}});

            idea.initializeState(eventsFromServer);
            assert.lengthOf(idea.eventsSinceSnapshot, 15000 + 1);

            // Just to see if applying events is working correctly
            expect(idea.title).to.be.equal('Lets check this one');

            // Now after some time, I am notified that my event wasn't processed - let see if replying on snapshot works
            idea.initializeState([{
                'type': 'FailedThatIdeaTitleWasChanged',
                'correlationId': correlationId
            }]);
            // Let check that we're not using snapshot anymore - since we know our first event was rejected
            //  - everything should be cleaned up
            expect(idea.snapshot).to.be.a('null');
            assert.lengthOf(idea.uncommittedEvents, 0);
            assert.lengthOf(idea.eventsSinceSnapshot, 0);
        });
    });
})
