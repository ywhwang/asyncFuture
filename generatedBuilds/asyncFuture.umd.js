!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.asyncFuture=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
/* Copyright (c) 2013 Billy Tetrud - Free to use for any purpose: MIT License*/

var trimArgs = _dereq_("trimArguments")


module.exports = Future

Future.debug = false // switch this to true if you want ids and long stack traces

var curId = 0         // for ids\
function Future(value) {
	if(arguments.length > 0) {
		var f = new Future()
        f.return(value)
        return f
	} else {
        this.isResolved = false
        this.queue = []
        this.n = 1 // future depth (for preventing "too much recursion" RangeErrors)
        if(Future.debug) {
            curId++
            this.id = curId
        }
    }
}

// static methods

// has one parameter: either a bunch of futures, or a single array of futures
// returns a promise that resolves when one of them errors, or when all of them succeeds
Future.all = function() {
    if(arguments[0] instanceof Array) {
        var futures = arguments[0]
    } else {
        var futures = trimArgs(arguments)
    }

    var f = new Future()
    var results = []

    if(futures.length > 0) {
        var current = futures[0]
        futures.forEach(function(future, index) {
            current = current.then(function(v) {
                results[index] = v
                return futures[index+1]
            })
        })

        //if
        current.catch(function(e) {
            f.throw(e)
        })
        // else
        current.then(function() {
            f.return(results)
        })


    } else {
        f.return(results)
    }

    return f
}

// either used like futureWrap(function(){ ... })(arg1,arg2,etc) or
//  futureWrap(object, 'methodName')(arg1,arg2,etc)
Future.wrap = function() {
    // function
    if(arguments.length === 1) {
        var fn = arguments[0]
        var object = undefined


    // object, function
    } else {
        var object = arguments[0]
        var fn = object[arguments[1]]
    }

    return function() {
        var args = Array.prototype.slice.call(arguments)
        var future = new Future
        args.push(future.resolver())
        var me = this
        if(object) me = object
        fn.apply(me, args)
        return future
    }
}

// future wraps a function who's callback only takes one parameter - the return value (no error is available)
// eg: function(result) {}
Future.wrapSingleParameter = function() {
    if(arguments.length === 1) {
        var fn = arguments[0]
    } else {
        var object = arguments[0]
        var method = arguments[1]
        var fn = object[method]
    }

    return function() {
        var args = Array.prototype.slice.call(arguments)
		var future = new Future
		args.push(function(result) {
		    future.return(result)
		})
		var me = this
        if(object) me = object
        fn.apply(me, args)
		return future
    }
}


// default
var unhandledErrorHandler = function(e) {
    setTimeout(function() {
        throw e
    },0)
}

// setup unhandled error handler
// unhandled errors happen when done is called, and  then an exception is thrown from the future
Future.error = function(handler) {
    unhandledErrorHandler = handler
}

// instance methods

// returns a value for the future (can only be executed once)
// if there are callbacks waiting on this value, they are run in the next tick
    // (ie they aren't run immediately, allowing the current thread of execution to complete)
Future.prototype.return = function(v) {
    resolve(this, 'return', v)
}
Future.prototype.throw = function(e) {
    if(this.location !== undefined) {
        e.stack += '\n    ---------------------------\n'+this.location.stack.split('\n').slice(4).join('\n')
    }
    resolve(this, 'error', e)
    return this
}

function setNext(that, future) {
    resolve(that, 'next', future)
}

function wait(that, cb) {
    if(that.isResolved) {
        executeCallbacks(that, [cb])
    } else {
        that.queue.push(cb)
    }
}

// duck typing to determine if something is or isn't a future
var isLikeAFuture = Future.isLikeAFuture = function(x) {
    return x.isResolved !== undefined && x.queue !== undefined && x.then !== undefined
}

function waitOnResult(f, result, cb) {
    wait(result, function() {
        if(this.hasError) {
            f.throw(this.error)
        } else if(this.hasNext) {
            waitOnResult(f, this.next, cb)
        } else {
            try {
                setNext(f, executeCallback(cb,this.result))
            } catch(e) {
                f.throw(e)
            }
        }
    })
}


// cb takes one parameter - the value returned
// cb can return a Future, in which case the result of that Future is passed to next-in-chain
Future.prototype.then = function(cb) {
    var f = createChainFuture(this)
    wait(this, function() {
        if(this.hasError)
            f.throw(this.error)
        else if(this.hasNext)
            waitOnResult(f, this.next, cb)
        else {
            try {
                setNext(f, executeCallback(cb,this.result))
            } catch(e) {
                f.throw(e)
            }
        }
    })
    return f
}
// cb takes one parameter - the error caught
// cb can return a Future, in which case the result of that Future is passed to next-in-chain
Future.prototype.catch = function(cb) {
    var f = createChainFuture(this)
    wait(this, function() {
        if(this.hasError) {
            try {
                setNext(f, executeCallback(cb,this.error))
            } catch(e) {
                f.throw(e)
            }
        } else if(this.hasNext) {
            this.next.then(function(v) {
                f.return(v)
            }).catch(function(e) {
                try {
                    setNext(f, executeCallback(cb,e))
                } catch(e) {
                    f.throw(e)
                }
            })
        } else {
            f.return(this.result)
        }
    })
    return f
}
// cb takes no parameters
// callback's return value is ignored, but thrown exceptions propogate normally
Future.prototype.finally = function(cb) {
    var f = createChainFuture(this)
    wait(this, function() {
        try {
            var that = this
            if(this.hasNext) {
                this.next.then(function(v) {
                    var x = executeCallback(cb)
                    f.return(v)
                    return x
                }).catch(function(e) {
                    var x = executeCallback(cb)
                    f.throw(e)
                    return x
                }).done()
            } else if(this.hasError) {
                Future(true).then(function() {
                    return executeCallback(cb)
                }).then(function() {
                    f.throw(that.error)
                }).catch(function(e) {
                    f.throw(e)
                }).done()

            } else  {
                Future(true).then(function() {
                    return executeCallback(cb)
                }).then(function() {
                    f.return(that.result)
                }).catch(function(e) {
                    f.throw(e)
                }).done()
            }
        } catch(e) {
            f.throw(e)
        }
    })
    return f
}

// a future created for the chain functions (then, catch, and finally)
function createChainFuture(that) {
    var f = new Future
    f.n = that.n + 1
    if(Future.debug) {
        f.location = createException()  // used for long traces
    }
    return f
}

// all unused futures should end with this (e.g. most then-chains)
// detatches the future so any propogated exception is thrown (so the exception isn't silently lost)
Future.prototype.done = function() {
    wait(this, function() {
        if(this.hasError) {
            unhandledErrorHandler(this.error)
        } else if(this.hasNext) {
            this.next.catch(function(e) {
                unhandledErrorHandler(e)
            })
        }
    })
}



Future.prototype.resolver = function() {
    var me = this

    return function(e,v) {
        if(e) { // error argument
            me.throw(e)
        } else {
            me.return(v)
        }
    }
}

Future.prototype.resolved = function() {
    return this.isResolved
}


function resolve(that, type, value) {
    if(that.isResolved)
        throw Error("Future resolved more than once! Resolution: "+value)

    that.isResolved = true
    that.hasError = type === 'error'
    that.hasNext = type === 'next' && value !== undefined

    if(that.hasError)
        that.error = value
    else if(that.hasNext)
        that.next = value
    else
        that.result = value

    // 100 is a pretty arbitrary number - it should be set significantly lower than common maximum stack depths, and high enough to make sure performance isn't significantly affected
    // in using this for deadunit, firefox was getting a recursion error at 150, but not at 100. This doesn't mean that it can't happen at 100 too, but it'll certainly make it less likely
    // if you're getting recursion errors even with this mechanism, you probably need to figure that out in your own code
    if(that.n % 100 !== 0) {
        executeCallbacks(that, that.queue)
    } else {
        setTimeout(function() { // this prevents too much recursion errors
            executeCallbacks(that, that.queue)
        }, 0)
    }
}

function executeCallbacks(that, callbacks) {
    if(callbacks.length > 0) {
        try {
            callbacks.forEach(function(cb) {
                cb.apply(that)
            })
        } catch(e) {
            unhandledErrorHandler(e)
        }
    }
}

// executes a callback and ensures that it returns a future
function executeCallback(cb, arg) {
    var r = cb(arg)
    if(r !== undefined && !isLikeAFuture(r) )
        throw Error("Value returned from then or catch ("+r+") is *not* a Future. Callback: "+cb.toString())

    return r
}

function createException() {
    try {
        throw new Error()
    } catch(e) {
        return e
    }
}
},{"trimArguments":2}],2:[function(_dereq_,module,exports){
// resolves varargs variable into more usable form
// args - should be a function arguments variable
// returns a javascript Array object of arguments that doesn't count trailing undefined values in the length
module.exports = function(theArguments) {
    var args = Array.prototype.slice.call(theArguments, 0)

    var count = 0;
    for(var n=args.length-1; n>=0; n--) {
        if(args[n] === undefined)
            count++
    }
    args.splice(-0, count)
    return args
}
},{}]},{},[1])
(1)
});