const server = require("ps-request"),
  webpack = require("webpack"),
  beautify = require('js-beautify').js,
  log = require("proudsmart-log")(),
  { tree, random, extend } = require("ps-ultility"),
  workpath = process.cwd(),
  pathLib = require("path"),
  isDirectory = view => view.isDir,
  isDashboard = view => view.viewType === "dashboard",
  defaultConfig = {
    username : "baowu_steel",
    password : "abc123"
  },
  psfile = require("ps-file"),
  __webpackConfig = {
    mode : "development",
    devtool : "#source-map",
    watch : false,
    module : {
      rules : [{
        test : /\.js$/,
        use:{
          loader:'babel-loader'
        },
        exclude:/node_modules/
      }]
    }
  };
let req = server("http://36.110.36.118:11780/api/rest/post/"),
  time = 0,
  userLoginUIService = req.service("userLoginUIService"),
  resourceUIService = req.service("resourceUIService"),
  viewFlexService = req.service("viewFlexService"),
  workfolder;
function getAllViews( callback ){
  return viewFlexService.post("getAllMyViews").then( views => {
    callback = typeof callback == "function"
      ? callback : function(){ return true };
    return success(views.filter( callback ))
  })
}
function writeFilesByViewId( viewId ){
  return viewFlexService.post("getViewById", viewId).then( view => {
    log.info( `start to load dashboard view : [ ${view.viewTitle} ] - ${view.viewId}` );
    let json = JSON.parse( view.content ),
      groups = ( json ? json.groups : [] ) || [{ path : "index", layout :json.layout }];
    if( workfolder.exist( view.viewId ) ){
      log.info(`${ view.viewId } folder is exist!!`)
    }
    function makeJson( str ){
      if( !str ){
        return "{}"
      }
      let rs = "{}"
      try {
        rs = typeof str === "string"
          ? JSON.stringify(eval(`(function( a ){ return a })(${str})`), null, 2)
          : JSON.stringify(str)
      } catch(e){
        console.log(typeof str);
      } finally{
        return rs;
      }
    }
    return ( workfolder.exist( view.viewId )
      ? workfolder.stat( view.viewId ).then( d => {
        return d.removeAll().then( d => {
          log.info(`${ view.viewId } folder is removed!!`)
          return workfolder.mkdir( view.viewId );
        })
      })
      : workfolder.mkdir( view.viewId ))
      .then( workfolder => {
        return workfolder.write("setting.js",beautify( `module.export = ${makeJson( json && json.setting)}` ))
          .then( d => {
          return workfolder.stat()
        });
      })
      .then( workfolder => {
        return workfolder.write("config.js", beautify(`module.exports = ${JSON.stringify({
          viewTitle : view.viewTitle,
          viewId : view.viewId,
          viewType : view.viewType
        }, null, 2)}`)).then( d => {
          return workfolder.stat()
        });
      })
      .then( workfolder => {
        return Promise.all(groups.map( ({ path, layout }) => {
          return ( workfolder.exist( path ) ? workfolder.mkdir( path + "_" ) : workfolder.mkdir( path ) ).then( workfolder => {
            let arr = [], map = [];
            tree("children").forEach(layout, (n,i,p,pl) => {
              let exp = n.advance && n.advance.expression || "", name = `./${n.type}_${arr.length}`, hash = random(), match;
              if( exp.length > 300){
                match = new RegExp("^([^{]*)\\{", "g").exec(exp);
                if( match ){
                  exp = exp.slice(match[1].length);
                } else {
                  console.log( exp )
                }
                arr.push( [name, `module.exports = ${ exp }`] );
                map.push({
                  name : hash,
                  exp : "require(\"" + name + ".js\")"
                })
                n.advance.expression = `__${hash}__`;
              }
            });
            function replaceExp( str ){
              let item = map.shift();
              if( item ) {
                return replaceExp(str.replace(new RegExp(`\\"__${item.name}__\\"`, "g"), item.exp));
              } else {
                return str;
              }
            }
            return Promise.all(arr.map( d => {
              return workfolder.write( d[0] + ".js", `/** 仪表板 : [ ${view.viewTitle} ] - ${view.viewId} **/\n${d[1]}`);
            })).then( d => {
              return workfolder.write("json.js", beautify(`/** 仪表板 : [ ${view.viewTitle} ] - ${view.viewId} **/
psdefine({
  "layout" : ${replaceExp(JSON.stringify(layout, null, 2))},
  "setting" : require("../setting.js")
})`, { indent_size: 2, space_in_empty_paren: true }))
            })
          })
        }))
      }).then( d => {
        log.success( `success to load dashboard view : [ ${view.viewTitle} ] - ${view.viewId}` );
        return success("success")
      })
  })
}
function execQueue( queue, seq, callback ) {
  let item = queue.shift();
  item ? log.info( `-------------  No.${ seq }  -------------`  ) : null;
  return item ? callback( item, seq ).then( d => {
    return execQueue( queue, seq + 1, callback )
  }) : success("all loaded!");
}
function success( d ){
  return new Promise((res,rej) => {
    res( d );
  })
}
function error( d ){
  return new Promise((res,rej) => {
    rej( {
      message : d
    });
  })
}
function getViewIds( d ){
  return Promise.all(d.map( n => success( n.viewId )));
}
function checkLogin( { username, password } ) {
  return new Promise((resolve, reject) => {
    userLoginUIService.post("getCurrentUser").then( d => {
      log.info( `account [${ username }/${ password }] is already logined, continue` );
      resolve( d );
    }).catch( e => {
      log.info(`no login`);
      userLoginUIService.post("login", [ username, password ]).then( d => {
        log.info( `account [${ username }/${ password }] has already been logined, continue` );
        resolve( d );
      }).catch( e => {
        reject( e );
      })
    })
  });
}
function checkFolderExist( folder, name ){
  return folder.exist( name )
    ? folder.stat( name )
    : folder.mkdir( name )
}
function write( query ){
  time = new Date();
  return checkLogin( defaultConfig ).then( d => {
    return psfile(pathLib.resolve(workpath)).stat()
  }).then( folder => {
    return checkFolderExist( folder, "app-views")
  }).then( folder => {
    return checkFolderExist( folder, "views")
  }).then( d => {
    workfolder = d;
    return ( query === "*" ? getAllViews( isDashboard ).then( getViewIds )
      : success(query.split(",")))
  }).then( viewIds => {
    return execQueue( viewIds, 0, ( viewId, inx ) => {
      return writeFilesByViewId( viewId );
    });
  }).then( d => {
    log.success(`---- all view loaded in ${toSecond(new Date() - time)}s ----`);
  }).catch( e => {
    e.message ? log.error( `message : ${e.message}` ) : null;
    e.stack ? log.error( `stack : ${e.stack}` ) : null;
  });
}
function toSecond( sec ){
  return ( sec / 1000 ).toFixed(2);
}
function packJSON( viewId, path ){
  return new Promise( (resolve, reject) => {
    let config = {
      entry : pathLib.join(workpath, `./app-views/views/${viewId}/${path}/json.js`),
      output : {
        path : pathLib.join(workpath, "./app-views/build/"),
        filename : `${viewId}.${path}.js`
      }
    }
    extend( config, __webpackConfig );
    let time = new Date();
    log.info(`start to pack ${viewId}, ${path}`);
    webpack(config, ( err, state ) => {
      if(err === null){
        if(state.hasErrors()){
          log.error(`Error : in ${viewId}, ${path} - ${toSecond(new Date() - time)}s`);
          for( var  i in state.compilation.errors){
            log.error(`detail : ${state.compilation.errors[i]}`);
          }
        } else {
          log.success(`success : in ${viewId}, ${path} - ${toSecond(new Date() - time)}s`);
        }
        resolve("compiled");
      } else {
        log.error(err.message);
        reject(err.message);
      }
    })
  });
}
function pack( query ){
  time = new Date();
  psfile(pathLib.resolve(workpath)).stat().then( folder => {
    return folder.exist("app-views") ? folder.stat("app-views") : error("no exist")
  }).then( folder => {
    return folder.exist("views") ? folder.stat("views") : error("no exist")
  }).then( folder => {
    workfolder = folder;
    return folder.readDir()
  }).then( viewIds => {
    let rs = [];
    return Promise.all(viewIds.filter(({basename}) => {
      if(query === "*"){
        return true;
      } else {
        return query.split(",").some( id => id == basename );
      }
    }).map( ({basename}) => {
      let viewId = basename;
      return workfolder.readDir(basename).then( attrs => {
        return Promise.all(attrs.filter(isDirectory).map(({basename}) => {
          rs.push({viewId, basename});
          return success( "success" );
        }))
      })
    })).then( d => {
      return success( rs )
    })
  }).then( d => {
    return execQueue( d, 0, ({ viewId, basename }) => {
      return packJSON( viewId, basename );
    });
  }).then( d => {
    log.success(`---- all view published in ${toSecond(new Date() - time)}s ----`);
  }).catch( e => {
    e.message ? log.error( `message : ${e.message}` ) : null;
    e.stack ? log.error( `stack : ${e.stack}` ) : null;
  });
}
function server( app ){
  function angularMiddleware( req, res, next ){
    let match = /app-views[\\\/]build[\\\/](\d+)\.([^.]+)\.js/.exec( req.url ),
      viewId, path;
    if( match ){
      viewId = match[1];
      path = match[2];
      packJSON( viewId, path).then( d=> {
        psfile(pathLib.join(workpath, `./app-views/build`))
          .read(`./${viewId}.${path}.js`).then( d => {
          res.setHeader(`Content-Type`, `application/javascript;charset=UTF-8`);
          res.write( d );
          res.end();
        })
      }).catch( e => {
        e.message ? log.error( `message : ${e.message}` ) : null;
        e.stack ? log.error( `stack : ${e.stack}` ) : null;
      });
    } else {
      next();
    }
  }
  app.use(angularMiddleware);
}
module.exports.server = server;
module.exports.write = write;
module.exports.pack = pack;