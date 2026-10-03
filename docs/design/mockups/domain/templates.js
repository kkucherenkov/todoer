// Read-only source snapshot: apps/web/app/utils/templates.ts. Type erasure only; local fixture use.
(()=>{window.TodoerDomain ||= {};
                                                  

                      
                     
                       
                     
                                          
                               
                                   

/** The tree each template writes (departure 9). Ids go in lower-case: the
 *  server compares a filter's strings as written. */
function filterOf(t          )         {
  switch (t.kind) {
    case 'today':
      return { or: [{ scheduled: { to: 0 } }, { due: { to: 0 } }] };
    case 'overdue':
      return { due: { to: -1 } };
    case 'next7':
      return {
        or: [{ scheduled: { from: 0, to: 6 } }, { due: { from: 0, to: 6 } }],
      };
    case 'project':
      return { project: t.id?.toLowerCase() ?? null };
    case 'tag':
      return { tag: t.id.toLowerCase() };
    case 'status':
      return { status: t.id.toLowerCase() };
  }
}

Object.assign(window.TodoerDomain,{filterOf});})();
