require = (function($root) {
	var BufferedReader = Java.type('java.io.BufferedReader');
	var InputStreamReader = Java.type('java.io.InputStreamReader');
	var FileInputStream = Java.type('java.io.FileInputStream');
	var BufferedWriter = Java.type('java.io.BufferedWriter');
	var OutputStreamWriter = Java.type('java.io.OutputStreamWriter');
	var FileOutputStream = Java.type('java.io.FileOutputStream');
	var File = Java.type('java.io.File');
	var Path = Java.type('java.nio.file.Paths');

	var isWin32 = Java.type('java.lang.System').getProperty('os.name').startsWith('Windows');
	var sep = isWin32 ? '\\' : '/';
	var wrapper = [
		'(function (exports, module, require, __filename, __dirname) {',
		'\n})'
	];

	function Exports() {
		this._isDefault = true;
	}
	
	function ExtLoader(ext, handler) {
		this.ext = ext[0] === '.' ? ext : '.' + ext;
		this.handler = handler;
	}

	function Module(id, filename) {
		this.id = id;
		this.filename = filename;
		this.fn = new Function();
		this.children = {};
		this.exports = new Exports();
		this.isLoaded = false;
	}

	Module._packageCache = Object.create(null);
	Module._exts = Object.create(null);

	Module._exts['.js'] = new ExtLoader('.js', function(input) {
		return input;
	});
	
	Module._exts['.json'] = new ExtLoader('.json', function(input) {
		return JSON.parse(input);
	});

	function fs_read(location) {
		var fIn = new BufferedReader(new InputStreamReader(new FileInputStream(location), "UTF8"));

		var line;
		var string = "";
		while ((line = fIn.readLine()) != null) {
			string += line + '\n';
		}

		fIn.close();
		return string;
	}	
	
	function fs_exists(path) {
		return new File(path).exists();
	}

	function path_absolute(path) {
		return Path.get(path).toAbsolutePath().toString();
	}
	
	function path_normalize(path) {
		return Path.get(path).normalize().toString();
	}
	
	function path_dirname(path) {
		var result = '';
		var subs = path.split(sep);
		for (var i = 0; i < subs.length - 1; i++) {
			result += (subs[i] + sep);
		}
		return result;
	}
	
	function path_resolve() {
		var paths = Array.prototype.slice.call(arguments);
		if (paths.length === 0) return '';
		var lastPath = Path.get(paths[0]);
		for (var i = 1; i < paths.length; i++) {
			lastPath = lastPath.resolve(Path.get(paths[i]));
		}
		
		return lastPath.toString();
	}

	function wrap(script) {
		return wrapper[0] + script + wrapper[1];
	}

	function isRequestRelative(request) {
		return request[0] == '.' && (request[1] == sep || request[1] == '.');
	}
	
	function assureExt(requestPath) {
		if (fs_exists(requestPath)) return requestPath;
		for (var field in Module._exts) {
			var loader = Module._exts[field];
			// at this point, we haven't found the file, so plug in the extensions and see if they exists
			var realPath = requestPath + loader.ext;
			if (fs_exists(realPath)) return realPath;
		}
		throw new Error('No loader for ' + requestPath + ' exists. To add one, reference require.exts');
	}
	
	function getLoader(filename) {
		for (var field in Module._exts) {
			if (filename.endsWith(field)) return Module._exts[field];
		}
		
		return Module._exts['.js'];
	}

	function resolveEntry(requestPath) {
		try {
			var jsonPath = path_resolve(requestPath, 'package.json');
			var json = fs_read(jsonPath);
			return JSON.parse(json).main;
		} catch (ex) {
			throw new Error('Failed to configure module ' + requestPath + ': ' + ex.message);
		}
	}

	/**
	 * Resolves the relative path to execution and the module that called the require.
	 * @param {String} request 
	 * @param {Module} caller 
	 */
	function resolveFile(request, caller) {
		if (!caller) caller = { filename: $root };
		var dir = path_dirname(caller.filename);
		return path_resolve(dir, request);
	}
	
	function tryFile(request, caller) {
		if (isRequestRelative(request)) {
			return resolveFile(request, caller);
		} else {
			return resolveEntry(path_resolve($root, request));
		}
	}
	
	// 1: from the request, determine what file the request is pointing to and return a Module for it
	function resolveModule(request, caller) {
		var file = tryFile(request, caller);
		var isRelative = isRequestRelative(request);
		if (!file && !isRelative) {
			// this will happen if the package.json doesn't include a 'main' property
			file = path_resolve($root, request, 'index.js');
		} else {
			// if we have a 'main' property in the package
			if (isRelative) {
				file = assureExt(file);
			} else {
				file = path_resolve($root, request, file);
			}
		}
		file = path_normalize(file);
		if (Module._packageCache[file]) return Module._packageCache[file];
		return new Module(request, file, isRelative ? caller : undefined);
	}
	
	// 2: from the returned Module, compile it and return it.
	function compileModule(module) {
		var loader = getLoader(module.filename);
		var script = fs_read(module.filename);
		var compiled = loader.handler(script); // if the file is JSON, then this will return a JSON object
		if (typeof compiled == 'string') {
			// if compiled is a string, that means we need to compile and eval
			var wrapped = wrap(compiled);
			module.fn = eval(wrapped);
		} else {
			// if compiled is an object, then we need to set the function as settings the module's exports
			module.fn = function() {
				module.exports = compiled;
			}
		}
	}
	
	// 3: from the compiled Module, ensure the safety of the object and cache it.
	function cacheModule(module) {
		Module._packageCache[module.filename] = module;
	}
	
	// 4: from the completed Module, run the body function and set the exports
	function exportModule(module) {
		var args = [
			// exports
			module.exports,
			// module
			module,
			// require,
			function (request) {
				return require(request, module)
			},
			// __filename
			module.filename,
			// __dirname
			path_dirname(module.filename)
		];
		
		try {
			module.fn.apply(null, args);
		} catch (ex) {
			console.log('\xA7cAn error occured when reading ' + module.filename);
			console.log(ex.getStackTrace());
			throw ex;
		}
		
		module.isLoaded = true;
	}
	
	function require(request, caller) {
		if (request[0] == '@') return eval(request.substr(1));
		if (isWin32) request = request.replace('/', '\\');
		else request = request.replace('\\', '/');
		var module = resolveModule(request, caller);
		if (Module._packageCache[module.filename]) {
			return Module._packageCache[module.filename].exports;
		}
		compileModule(module);
		exportModule(module);
		cacheModule(module);
		return module.exports;
	}

	require.unregisterModules = function() {
		Module._packageCache = Object.create(null);
	}

	require.exts = Module._exts;

	return require;
})('./plugins/Thiq/node_modules'); // the root location of the installed modules
