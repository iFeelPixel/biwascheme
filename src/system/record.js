//
// Record
//
BiwaScheme.debug = function(){}; //console.debug;
BiwaScheme.Record = Class.create({
  initialize: function(rtd, values){
    assert_record_td(rtd, "new Record");

    this.rtd = rtd;
    this.fields = values;
  },
  get: function(k){
    return this.fields[k]
  },
  set: function(k, v){
    this.fields[k] = v;
  },
  toString: function(){
    var contents = BiwaScheme.to_write(this.fields);
    return "#<Record "+this.rtd.name+" "+contents+">";
  }
});
BiwaScheme.isRecord = function(o){
  return (o instanceof BiwaScheme.Record);
};

// Record types
BiwaScheme.Record._DefinedTypes = new Hash();

BiwaScheme.Record.define_type = function(name_str, rtd, cd){
  return BiwaScheme.Record._DefinedTypes.set(name_str, {rtd: rtd, cd: cd});
};
BiwaScheme.Record.get_type = function(name_str){
  return BiwaScheme.Record._DefinedTypes.get(name_str);
};

// Record type descriptor
BiwaScheme.Record.RTD = Class.create({
  //                   Symbol RTD        Symbol Bool  Bool    Array
  initialize: function(name, parent_rtd, uid, sealed, opaque, fields){
    this.name = name;
    this.parent_rtd = parent_rtd;
    this.is_base_type = !parent_rtd;
    if(uid){
      this.uid = uid;
      this.generative = false;
    }
    else{
      this.uid = this._generate_new_uid();;
      this.generative = true;
    }

    this.sealed = !!sealed;
    this.opaque = parent_rtd.opaque || (!!opaque);

    this.fields = fields.map(function(field){
      return {name: field[0], mutable: !!field[1]};
    });
  },
  _generate_new_uid: function(){
    var n = (BiwaScheme.Record.RTD.last_uid++);
    return BiwaScheme.Sym("__record_td_uid_"+n);
  },
  toString: function(){
    return "#<RecordTD "+name+">";
  }
});
BiwaScheme.Record.RTD.last_uid = 0;
BiwaScheme.Record.RTD.NongenerativeRecords = new Hash();
BiwaScheme.isRecordTD = function(o){
  return (o instanceof BiwaScheme.Record.RTD);
};

// Record constructor descriptor
BiwaScheme.Record.CD = Class.create({
  initialize: function(rtd, parent_cd, protocol){
    this._check(rtd, parent_cd, protocol);
    this.rtd = rtd;
    this.parent_cd = parent_cd;
    if(protocol){
      this.has_custom_protocol = true;
      this.protocol = protocol;
    }
    else{
      this.has_custom_protocol = false;
      if(rtd.parent_rtd)
        this.protocol = this._default_protocol_for_derived_types();
      else
        this.protocol = this._default_protocol_for_base_types();
    }
  },

  _check: function(rtd, parent_cd, protocol){
    if(rtd.is_base_type && parent_cd)
      throw new Error("Record.CD.new: cannot specify parent cd of a base type");

    if(parent_cd && rtd.parent_rtd && (parent_cd.rtd != rtd.parent_rtd))
      throw new Error("Record.CD.new: mismatched parents between rtd and parent_cd");

    if(rtd.parent_rtd && !parent_cd && protocol)
      throw new Error("Record.CD.new: protocol must be #f when parent_cd is not given");

    if(parent_cd && parent_cd.has_custom_protocol && !protocol)
      throw new Error("Record.CD.new: protocol must be specified when parent_cd has a custom protocol");
  },
  
  _default_protocol_for_base_types: function(){
    // (lambda (p) p)
    // called with `p' as an argument
    return function(ar){
      var p = ar[0];
      assert_procedure(p, "_default_protocol/base");
      return p;
    };
  },

  _default_protocol_for_derived_types: function(){
    // (lambda (n) 
    //   (lambda (a b x y s t)
    //     (let1 p (n a b x y) (p s t))))
    // called with `n' as an argument
    var rtd = this.rtd;
    return function(ar){
      var n = ar[0];
      assert_procedure(n, "_default_protocol/n");

      var ctor = function(args){
        var my_argc = rtd.fields.length;
        var ancestor_argc = args.length - my_argc;

        var ancestor_values = args.slice(0, ancestor_argc);
        var my_values       = args.slice(ancestor_argc);
        BiwaScheme.debug($H({ctor_args: args}).inspect());

        // (n a b x y) => p
        return new BiwaScheme.Call(n, ancestor_values, function(ar){
          var p = ar[0];
          assert_procedure(p, "_default_protocol/p");
          BiwaScheme.debug($H({ctor_p_my: my_values, ancestor_values: ancestor_values}).inspect());

          // (p s t) => record
          return new BiwaScheme.Call(p, my_values, function(ar){
            var record = ar[0];
            assert_record(record, "_default_protocol/result");

            return record;
          });
        });
      };
      return ctor;
    };
  },

  toString: function(){
    return "#<RecordCD "+this.rtd.name+">";
  },

  record_constructor: function(){
    var arg_for_protocol = (this.parent_cd ? this._make_n([], this.rtd)
                                           : this._make_p()).bind(this);

    return new BiwaScheme.Call(this.protocol, [arg_for_protocol], function(ar){
      var ctor = ar[0];
      assert_procedure(ctor, "record_constructor");
      return ctor;
    });
  },

  // Create the function `p' which is given to the protocol.
  _make_p: function(){
    return function(values){
      return new BiwaScheme.Record(this.rtd, values);
      // TODO: check argc 
    };
  },

  // Create the function `n' which is given to the protocol.
  // When creating an instance of a derived type,
  // _make_n is called for each ancestor rtd's.
  _make_n: function(children_values, rtd){
    var parent_cd = this.parent_cd;

    if(parent_cd){
      // called from protocol (n)
      var n = function(args_for_n){
        BiwaScheme.debug($H({maken_n: args_for_n}).inspect());

        // called from protocol (p)
        var p = function(args_for_p){
          var values = [].concat(args_for_p[0]).concat(children_values)
          var parent_n = parent_cd._make_n(values, rtd);
          BiwaScheme.debug($H({maken_p: args_for_p}).inspect());

          return new BiwaScheme.Call(parent_cd.protocol, [parent_n], function(ar){
            var ctor = ar[0];
            assert_procedure(ctor, "_make_n");

            return new BiwaScheme.Call(ctor, args_for_n, function(ar){
              var record = ar[0];
              assert_record(record);
              BiwaScheme.debug($H({maken2_ar: ar}).inspect());
              return record;
            });
          });
        };
        return p;
      };
      return n;
    }
    else{
      var n = function(my_values){
        var values = my_values.concat(children_values);
        BiwaScheme.debug($H({base_n: values}).inspect());
        return new BiwaScheme.Record(rtd, values);
        // TODO: check argc 
      };
      return n;
    }
  }
});

BiwaScheme.isRecordCD = function(o){
  return (o instanceof BiwaScheme.Record.CD);
};
