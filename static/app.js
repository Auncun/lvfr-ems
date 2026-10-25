--- app.js.before_note	2026-10-25 17:31:36.530366934 +0100
+++ ems/lvfr-ems-main/static/app.js	2026-10-25 17:31:36.598499044 +0100
@@ -3704,10 +3704,26 @@
         if (addInstructor) addInstructor.disabled = !value || isInstructor;
         if (deleteInstructor) deleteInstructor.disabled = !value || !isInstructor;
     }
+    updateNoteButton();
+}
+
+// Save Note needs text for Add and Edit; Delete needs no text.
+function updateNoteButton() {
+    const action = $("#noteAction");
+    const text = $("#note");
+    const button = $('#modalContent button[data-action="note"]');
+    if (!action || !text || !button) return;
+    button.disabled = action.value !== "Delete" && !text.value.trim();
 }
 
 document.addEventListener("change", event => {
-    if (["activity", "training", "instructorType"].includes(event.target?.id)) updateManageButtons();
+    if (["activity", "training", "instructorType", "noteAction"].includes(event.target?.id)) {
+        updateManageButtons();
+        updateNoteButton();
+    }
+});
+document.addEventListener("input", event => {
+    if (event.target?.id === "note") updateNoteButton();
 });
 
 function openManage(cs) {